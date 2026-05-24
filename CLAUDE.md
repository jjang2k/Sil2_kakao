# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MVP prototype: static HTML + JS web app that ingests a KakaoTalk CSV export and uses the OpenAI API to produce a chat summary plus action items for the chat room owner (방장). Korean-first UI.

**Intentional non-choices**: no backend, no database, no build step, no bundler, no lint config. Three-file app (`index.html` + `lib.js` + `app.js`). `package.json` exists only to declare Vitest as a dev dependency for unit testing the pure functions in `lib.js`; nothing it pulls in is loaded by the browser. Treat additions of any other tooling (build step, bundler, lint, framework) as scope creep — confirm with the user.

## Run / develop

```bash
python3 -m http.server 8765      # serve current dir
# open http://localhost:8765
```

`file://` is not supported — the app uses `fetch("/.env")` and `fetch("https://api.openai.com/...")` which require an HTTP origin.

Unit tests cover the pure functions in `lib.js`:

```bash
npm install                      # one-time, installs Vitest
npm test                         # vitest run (CI mode)
npm run test:watch               # interactive
```

Tests live in `tests/lib.test.js` and load `lib.js` via `node:vm` so the same file can stay browser-loadable. **DOM-bound code in `app.js` is intentionally not tested** — verify those changes by reloading the browser and walking the flow with the bundled sample CSV (`KakaoTalk_Chat_[실밸개발자] 바이브코딩 클럽_*.csv`, ~27k rows / 3.1MB).

JS-only syntax check: `node --check app.js && node --check lib.js`.

## Architecture

See **[architecture.md](./architecture.md)** for the full data flow diagram, per-module responsibilities (key resolution, CSV parsing, date parsing, filter pipeline, token budget, LLM contract, rendering), state shape, and external dependencies.

Quick orientation before diving in:

- Pure functions are in `lib.js` (testable); DOM-bound logic and state are in `app.js`; UI and styles are inline in `index.html`. `lib.js` must remain DOM-free and module-syntax-free so it loads both as a browser `<script>` and via Vitest's `node:vm`.
- Pipeline: CSV → PapaParse → filter → format → OpenAI (JSON mode) → render.
- The system prompt JSON schema and `renderResult` are **coupled** — change them together.
- `parseKakaoDate` is required for the `YYYY.M.D H:mm` format; the native `Date` parser does not accept it.

## Conventions specific to this repo

- All styles live inline in `<style>` inside `index.html`. No separate CSS file.
- Plain ES, no modules, no transpile. DOM accessed via the `$(id)` helper.
- UI strings are Korean. Keep that — the target user is a Korean-speaking 방장.
- Commit message style (single existing example): short imperative subject, no conventional-commits prefix.

## Git hygiene

- `.env` is gitignored (`.gitignore:31`). Always stage files explicitly (`git add app.js index.html ...`) — never `git add .` — to keep `.env` accidents impossible by habit.
- All `*.csv` are gitignored (`.gitignore:71`). The bundled sample CSV exists in the working directory but is not tracked; do not force-add it.
