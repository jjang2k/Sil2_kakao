// 순수 함수 모음. 브라우저에서는 <script>로 로드되어 함수가 글로벌이 됩니다.
// Vitest는 tests/lib.test.js에서 node:vm으로 이 파일을 컨텍스트에 로드해 함수를 꺼냅니다.
// 모듈 문법을 쓰지 않는 이유: 동일 파일이 브라우저 <script>로도 동작해야 하므로.

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

// CSV 헤더 휴리스틱 매핑. 매칭 실패 시 첫 3개 컬럼으로 폴백.
function mapColumns(headers) {
  const find = (re) => headers.find((h) => re.test(h));
  return {
    date: find(/^(date|날짜|time|일시)$/i) || headers[0],
    user: find(/^(user|name|sender|이름|발신자|작성자)$/i) || headers[1],
    message: find(/^(message|메시지|content|내용)$/i) || headers[2],
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

