# Architecture

End-to-end flow lives entirely in the browser. No backend, no build step.

```
CSV file ─► PapaParse (CDN) ─► parseKakaoDate + column auto-map
                                       │
                                       ▼
                          state.rawMessages [{date, user, message}]
                                       │
              ┌────── applyFilters() ──┤   reactive on filter UI change
              │       (time range + noise regexes)
              ▼
       state.filteredMessages ──► formatMessages() ──► estimateTokens()
                                       │                       │
                                       ▼                       ▼
                          OpenAI chat.completions       token budget bar
                          (response_format: json_object) (warn @60k, block @100k)
                                       │
                                       ▼
                                renderResult()
                          summary / topics / 4 action categories
```

## Modules

`lib.js` holds DOM-free pure functions (`parseKakaoDate`, `estimateTokens`, `mapColumns`, `escapeHtml`, `pad2`, `fmtShort`). It is loaded before `app.js` as a classic script — its top-level `function` declarations become globals that `app.js` references. The split exists so Vitest can load `lib.js` via `node:vm` without touching the DOM-bound code in `app.js`.

`app.js` holds everything else: state, DOM wiring, fetch I/O, rendering.

### Key resolution — `loadKeyUI`, `loadEnvFile`

Priority: `.env` → `localStorage` → manual input. `.env` is fetched and parsed in-browser; values are mirrored into `localStorage` so subsequent loads work even if `.env` is removed.

**Security implication**: anything serving the directory exposes `.env` at `/.env`. Strictly local-dev only. The `.env.example` header carries the same warning.

### CSV parsing — `onParsed`, `mapColumns`

PapaParse with `header: true, skipEmptyLines: true`. `mapColumns` does heuristic regex match of header names to `date | user | message` (Korean and English variants like `Date`, `날짜`, `User`, `이름`, `Message`, `메시지`). Falls back to the first three columns by position if the regex misses.

### Date parsing — `parseKakaoDate`

KakaoTalk exports `YYYY.M.D H:mm` with **no zero-padding** (e.g. `2026.4.30 9:53`). Native `Date` parser does not accept this — always go through `parseKakaoDate`. Returns `null` on parse failure; rows with unparseable dates are dropped during ingest.

### Filter pipeline — `applyFilters`

Two filter categories applied sequentially:

1. **Time window** — cutoff is relative to the *last message in the file*, not `Date.now()`. This makes the app deterministic for old CSVs.
2. **Noise regexes** — three independent toggles:
   - join/leave system messages (`/님이 (들어왔|나갔)습니다/`)
   - media-only (`^(사진|동영상|이모티콘|삭제된 메시지입니다)$`)
   - URL-only (`^https?:\/\/\S+$`)

Re-runs on every filter UI change and updates the token budget bar.

### Token budget — `estimateTokens`

Char-count heuristic with extra weight for Hangul/CJK Unicode ranges (~1 token/char) versus ASCII (~0.4 token/char). Not a real tokenizer — tuned conservatively to stay safe without bundling tiktoken.

- `TOKEN_WARN_LIMIT = 60_000` → yellow bar
- `TOKEN_HARD_LIMIT = 100_000` → red bar + analyze button disabled

### LLM contract — `SYSTEM_PROMPT` + `runAnalysis`

Korean system prompt that **locks the model to a fixed JSON shape**:

```
{
  summary: string,
  topics: [{title, detail, participants}],
  action_items: {
    questions:     [{description, asked_by, time, priority}],
    announcements: [{description, reason, priority}],
    moderation:    [{description, involved, priority}],
    followups:     [{description, context, priority}]
  }
}
```

Always pass `response_format: { type: "json_object" }`. The renderer assumes this shape verbatim.

> ⚠️ **Coupling**: if you change the JSON schema, update the example in `SYSTEM_PROMPT` *and* the mapping in `renderResult` / `renderActionGroup` together. They are not validated at runtime — a mismatch silently degrades the output.

### Rendering — `renderResult`, `renderActionGroup`

Plain `innerHTML` with `escapeHtml` on every interpolated string. Each action category has its own `mapper` lambda that pulls the relevant fields (e.g. `questions` exposes `asked_by + time`, `moderation` exposes `involved`). Priority badges (`high|med|low`) drive both the left border color and the badge tint via CSS classes defined in `index.html`.

## State

Single mutable `state` object at the top of `app.js`:

```js
{
  rawMessages: [{date: Date, user: string, message: string}],
  filteredMessages: [...],
  fileName: string | null
}
```

No reactive framework — DOM updates are pushed imperatively from `applyFilters` and `renderResult`.

## External dependencies

- **PapaParse 5.4.1** via jsDelivr CDN. Only used inside `handleFile`.
- **OpenAI Chat Completions API** (`https://api.openai.com/v1/chat/completions`). Called once per analysis with `fetch`. Errors are surfaced verbatim from the response body where possible (401 / 429 / 5xx all routed through the same `catch`).

No other runtime dependencies at app level — `package.json` exists solely for the Vitest dev dependency (test-time only, never loaded by the browser).
