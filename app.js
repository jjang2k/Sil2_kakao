// ===== 상태 =====
const state = {
  rawMessages: [], // [{date: Date, user: string, message: string}]
  filteredMessages: [],
  fileName: null,
};

// ===== 유틸 =====
const $ = (id) => document.getElementById(id);
const LS_KEY = "openai_api_key";
const LS_MODEL = "openai_model";

// 약 100k 토큰 한도. 한글 1자 ≈ 1.5~2 토큰으로 보고 보수적으로 환산.
const TOKEN_HARD_LIMIT = 100_000;
const TOKEN_WARN_LIMIT = 60_000;

function estimateTokens(text) {
  // 영어/숫자/공백은 ~0.3 토큰/문자, 한글/CJK는 ~1 토큰/문자에 가까움.
  // MVP라 간단히: 한글이 많으면 길이 * 0.9, 그 외는 길이 * 0.4
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x3000 && code <= 0x9fff) cjk++;
    else if (code >= 0xac00 && code <= 0xd7af) cjk++;
  }
  const ratio = cjk / Math.max(text.length, 1);
  const perChar = 0.4 + ratio * 0.6; // 0.4 ~ 1.0
  return Math.ceil(text.length * perChar);
}

function parseKakaoDate(s) {
  // "2026.4.30 9:53" -> Date
  const m = String(s).trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi);
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function fmtShort(d) {
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ===== API 키 관리 =====
// 우선순위: .env (페이지 로드 시 자동) > localStorage > 수동 입력
async function loadEnvFile() {
  try {
    const res = await fetch(".env", { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      // 따옴표 제거
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[k] = v;
    }
    return env;
  } catch {
    return null;
  }
}

function setKeyStatus(msg, color) {
  $("keyStatus").textContent = msg;
  $("keyStatus").style.color = color;
}

async function loadKeyUI() {
  // 1) .env 우선
  const env = await loadEnvFile();
  if (env?.OPENAI_API_KEY && env.OPENAI_API_KEY.startsWith("sk-") && env.OPENAI_API_KEY !== "sk-your-key-here") {
    localStorage.setItem(LS_KEY, env.OPENAI_API_KEY);
    if (env.OPENAI_MODEL) localStorage.setItem(LS_MODEL, env.OPENAI_MODEL);
    const k = env.OPENAI_API_KEY;
    $("apiKey").value = k;
    $("model").value = env.OPENAI_MODEL || localStorage.getItem(LS_MODEL) || "gpt-5-mini";
    setKeyStatus(`✅ .env에서 키 로드됨 (${k.slice(0, 7)}...${k.slice(-4)})`, "#16a34a");
    return;
  }

  // 2) localStorage fallback
  const key = localStorage.getItem(LS_KEY);
  const model = localStorage.getItem(LS_MODEL) || "gpt-5-mini";
  $("model").value = model;
  if (key) {
    $("apiKey").value = key;
    setKeyStatus(`✅ 저장된 키 사용 중 (${key.slice(0, 7)}...${key.slice(-4)})`, "#16a34a");
  } else {
    setKeyStatus("키를 입력하고 저장하거나, .env 파일에 OPENAI_API_KEY를 설정하세요.", "#64748b");
  }
}

$("saveKey").addEventListener("click", () => {
  const v = $("apiKey").value.trim();
  if (!v.startsWith("sk-")) {
    alert("OpenAI API 키는 'sk-'로 시작합니다.");
    return;
  }
  localStorage.setItem(LS_KEY, v);
  localStorage.setItem(LS_MODEL, $("model").value);
  loadKeyUI();
});

$("model").addEventListener("change", () => {
  localStorage.setItem(LS_MODEL, $("model").value);
});

$("resetKey").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY);
  $("apiKey").value = "";
  loadKeyUI();
});

// ===== CSV 업로드 (drag&drop + 파일 선택) =====
const dropZone = $("dropZone");
const fileInput = $("csvFile");

["dragover", "dragenter"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  })
);
dropZone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  state.fileName = file.name;
  $("parseError").classList.add("hidden");
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => onParsed(results),
    error: (err) => showParseError("파싱 실패: " + err.message),
  });
}

function showParseError(msg) {
  $("parseError").textContent = msg;
  $("parseError").classList.remove("hidden");
}

// 헤더 휴리스틱 매핑
function mapColumns(headers) {
  const find = (re) => headers.find((h) => re.test(h));
  return {
    date: find(/^(date|날짜|time|일시)$/i) || headers[0],
    user: find(/^(user|name|sender|이름|발신자|작성자)$/i) || headers[1],
    message: find(/^(message|메시지|content|내용)$/i) || headers[2],
  };
}

function onParsed(results) {
  if (!results.data.length) {
    showParseError("CSV에 데이터 행이 없습니다.");
    return;
  }
  const headers = results.meta.fields || [];
  if (headers.length < 3) {
    showParseError(`컬럼이 3개 이상이어야 합니다 (현재: ${headers.join(", ")})`);
    return;
  }
  const cols = mapColumns(headers);
  const rows = [];
  for (const r of results.data) {
    const dateStr = r[cols.date];
    const user = (r[cols.user] || "").trim();
    const message = (r[cols.message] || "").toString();
    if (!dateStr || !user || !message) continue;
    const date = parseKakaoDate(dateStr);
    if (!date || isNaN(date.getTime())) continue;
    rows.push({ date, user, message });
  }
  if (!rows.length) {
    showParseError("유효한 메시지를 하나도 파싱하지 못했습니다. 컬럼/날짜 포맷을 확인하세요.");
    return;
  }
  state.rawMessages = rows.sort((a, b) => a.date - b.date);
  showMeta();
}

// ===== 메타 + 필터 패널 =====
function showMeta() {
  const msgs = state.rawMessages;
  const users = new Set(msgs.map((m) => m.user));
  const first = msgs[0].date;
  const last = msgs[msgs.length - 1].date;
  $("metaGrid").innerHTML = `
    <div class="stat"><div class="label">총 메시지</div><div class="value">${msgs.length.toLocaleString()}</div></div>
    <div class="stat"><div class="label">참여자</div><div class="value">${users.size}명</div></div>
    <div class="stat"><div class="label">시작</div><div class="value">${fmtShort(first)}</div></div>
    <div class="stat"><div class="label">끝</div><div class="value">${fmtShort(last)}</div></div>
  `;
  $("card-meta").classList.remove("hidden");
  applyFilters();
}

["timeRange", "filterJoin", "filterMedia", "filterUrlOnly"].forEach((id) =>
  $(id).addEventListener("change", applyFilters)
);

function applyFilters() {
  const msgs = state.rawMessages;
  if (!msgs.length) return;
  const hours = parseInt($("timeRange").value, 10);
  const skipJoin = $("filterJoin").checked;
  const skipMedia = $("filterMedia").checked;
  const skipUrl = $("filterUrlOnly").checked;

  let cutoff = null;
  if (hours > 0) {
    cutoff = new Date(msgs[msgs.length - 1].date.getTime() - hours * 3600 * 1000);
  }

  const reJoin = /(님이 들어왔습니다|님이 나갔습니다)/;
  const reMediaOnly = /^(사진|동영상|이모티콘|삭제된 메시지입니다)$/;
  const reUrlOnly = /^https?:\/\/\S+$/;

  const filtered = msgs.filter((m) => {
    if (cutoff && m.date < cutoff) return false;
    const t = m.message.trim();
    if (skipJoin && reJoin.test(t)) return false;
    if (skipMedia && reMediaOnly.test(t)) return false;
    if (skipUrl && reUrlOnly.test(t)) return false;
    return true;
  });

  state.filteredMessages = filtered;

  const text = formatMessages(filtered);
  const tokens = estimateTokens(text);

  const bar = $("tokenBar");
  bar.classList.remove("warn", "danger");
  let msg = `현재 <b>${filtered.length.toLocaleString()}</b>개 메시지, 약 <b>${tokens.toLocaleString()}</b> 토큰`;
  if (tokens > TOKEN_HARD_LIMIT) {
    bar.classList.add("danger");
    msg += ` — ⛔ 한도(${TOKEN_HARD_LIMIT.toLocaleString()}) 초과. 시간 범위를 좁히거나 필터를 강화하세요.`;
    $("analyze").disabled = true;
  } else if (tokens > TOKEN_WARN_LIMIT) {
    bar.classList.add("warn");
    msg += ` — ⚠️ 큽니다. 비용이 많이 들 수 있어요.`;
    $("analyze").disabled = filtered.length === 0;
  } else {
    $("analyze").disabled = filtered.length === 0;
  }
  if (filtered.length === 0) {
    msg = "⚠️ 필터 조건에 맞는 메시지가 없습니다.";
    $("analyze").disabled = true;
  }
  bar.innerHTML = msg;
}

function formatMessages(msgs) {
  return msgs.map((m) => `[${fmtShort(m.date)}] ${m.user}: ${m.message.replace(/\n/g, " ")}`).join("\n");
}

// ===== 분석 호출 =====
$("analyze").addEventListener("click", runAnalysis);

const SYSTEM_PROMPT = `당신은 카카오톡 채팅방의 **방장(커뮤니티 운영자) 전담 비서**입니다.
방장이 며칠 동안 채팅방을 못 봤다고 가정하고, 그동안의 대화를 요약하고 **방장이 직접 처리해야 할 일**을 빠짐없이 정리하는 것이 목표입니다.

다음 JSON 스키마로만 응답하세요 (마크다운 금지, JSON only):

{
  "summary": "전체 대화의 핵심을 3~5문장의 한국어로 요약",
  "topics": [
    { "title": "토픽 제목", "detail": "1~2문장 설명", "participants": ["주요 발언자1", "발언자2"] }
  ],
  "action_items": {
    "questions": [
      { "description": "방장이 답해야 할 질문 요약", "asked_by": "질문한 사람", "time": "MM.DD HH:mm", "priority": "high|med|low" }
    ],
    "announcements": [
      { "description": "방장이 공지/안내해야 할 내용", "reason": "왜 필요한지", "priority": "high|med|low" }
    ],
    "moderation": [
      { "description": "갈등/중재 필요 사항", "involved": ["관련자"], "priority": "high|med|low" }
    ],
    "followups": [
      { "description": "후속 조치(투표/일정/결정 보류 등)", "context": "관련 맥락", "priority": "high|med|low" }
    ]
  }
}

규칙:
- 빈 카테고리는 빈 배열 \`[]\`로 두세요.
- "사진/동영상" 같은 미디어 메시지는 무시하세요.
- 일반 잡담은 액션 아이템에 넣지 마세요. 방장 개입이 필요한 것만.
- priority는 시급성/중요도 기준으로 보수적으로 매기세요.`;

async function runAnalysis() {
  const key = localStorage.getItem(LS_KEY);
  if (!key) {
    alert("먼저 OpenAI API 키를 저장하세요.");
    return;
  }
  const model = localStorage.getItem(LS_MODEL) || "gpt-5-mini";

  const card = $("card-result");
  const body = $("resultBody");
  card.classList.remove("hidden");
  body.innerHTML = `<div class="loading"><div class="spinner"></div> 분석 중... (${state.filteredMessages.length.toLocaleString()}개 메시지)</div>`;
  $("analyze").disabled = true;

  const userContent = `다음은 카카오톡 채팅방 "${state.fileName || "채팅방"}"의 대화 로그입니다 (시간순).

${formatMessages(state.filteredMessages)}

위 대화를 분석해서 지정된 JSON 스키마로 응답하세요.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let detail = errText;
      try { detail = JSON.parse(errText).error?.message || errText; } catch {}
      throw new Error(`OpenAI API ${res.status}: ${detail}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("응답에 content가 없습니다.");
    const parsed = JSON.parse(content);
    renderResult(parsed);
  } catch (err) {
    body.innerHTML = `<div class="error">❌ ${err.message}</div>`;
  } finally {
    $("analyze").disabled = false;
  }
}

// ===== 렌더링 =====
function renderResult(r) {
  const body = $("resultBody");
  const usedCount = state.filteredMessages.length;
  const totalCount = state.rawMessages.length;

  const summaryHtml = `
    <div style="background: #f0f9ff; padding: 14px 16px; border-radius: 8px; margin-bottom: 18px;">
      <div style="font-weight: 700; margin-bottom: 6px;">📋 전체 요약</div>
      <div class="summary-text">${escapeHtml(r.summary || "(요약 없음)")}</div>
    </div>
  `;

  const topicsHtml = `
    <div style="margin-bottom: 18px;">
      <div style="font-weight: 700; margin-bottom: 8px;">🔥 주요 토픽</div>
      ${
        (r.topics || []).length === 0
          ? '<div style="color:#94a3b8; font-size:13px;">(추출된 토픽 없음)</div>'
          : `<ul class="topic-list">${(r.topics || [])
              .map(
                (t) =>
                  `<li><b>${escapeHtml(t.title || "")}</b> — ${escapeHtml(t.detail || "")}${
                    t.participants?.length
                      ? ` <span style="color:#64748b;">(${t.participants.map(escapeHtml).join(", ")})</span>`
                      : ""
                  }</li>`
              )
              .join("")}</ul>`
      }
    </div>
  `;

  const ai = r.action_items || {};
  const actionHtml = `
    <div>
      <div style="font-weight: 700; margin-bottom: 8px;">✅ 방장 액션 아이템</div>
      ${renderActionGroup("❓ 답변 필요한 질문", ai.questions, (it) => ({
        main: it.description,
        meta: [it.asked_by, it.time].filter(Boolean).join(" · "),
        priority: it.priority,
      }))}
      ${renderActionGroup("📢 공지·안내 필요", ai.announcements, (it) => ({
        main: it.description,
        meta: it.reason,
        priority: it.priority,
      }))}
      ${renderActionGroup("⚖️ 갈등·중재 필요", ai.moderation, (it) => ({
        main: it.description,
        meta: it.involved?.join(", "),
        priority: it.priority,
      }))}
      ${renderActionGroup("🔁 후속 조치", ai.followups, (it) => ({
        main: it.description,
        meta: it.context,
        priority: it.priority,
      }))}
    </div>
  `;

  const footHtml = `
    <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
      🧾 사용된 메시지: ${usedCount.toLocaleString()} / 전체 ${totalCount.toLocaleString()} · 모델: ${escapeHtml(localStorage.getItem(LS_MODEL) || "gpt-5-mini")}
    </div>
  `;

  body.innerHTML = summaryHtml + topicsHtml + actionHtml + footHtml;
}

function renderActionGroup(title, items, mapper) {
  items = items || [];
  if (items.length === 0) {
    return `
      <div class="action-group">
        <h3>${title}</h3>
        <div style="color:#94a3b8; font-size:13px;">없음</div>
      </div>`;
  }
  return `
    <div class="action-group">
      <h3>${title} <span style="font-weight:400; color:#64748b;">(${items.length})</span></h3>
      ${items
        .map((it) => {
          const m = mapper(it);
          const p = (m.priority || "low").toLowerCase();
          return `
            <div class="action-item ${p}">
              <div class="desc">${escapeHtml(m.main || "(내용 없음)")} <span class="badge ${p}">${p.toUpperCase()}</span></div>
              ${m.meta ? `<div class="refs">${escapeHtml(m.meta)}</div>` : ""}
            </div>`;
        })
        .join("")}
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ===== 초기화 =====
loadKeyUI();
