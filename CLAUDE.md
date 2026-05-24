# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MVP prototype: static HTML + JS web app that ingests a KakaoTalk CSV export and uses the OpenAI API to produce a chat summary plus action items for the chat room owner (방장). Korean-first UI.

**Project policy** (some enforced by tooling):

- **Static front-end** — no backend, no database, no build step, no bundler, no lint config. Three browser-loaded files (`index.html` + `lib.js` + `app.js`). The only runtime dep is the PapaParse CDN; nothing from `node_modules` is shipped.
- **`package.json` is test-time-only** — declares Vitest as a dev dependency. Never imported from `index.html`.
- **Test-first for JS** — Vitest covers pure functions in `lib.js`. A PreToolUse TDD-guard hook (see [TDD guard](#tdd-guard-hook) below) enforces test-file presence before any `.js`/`.jsx`/`.ts`/`.tsx` edit.

Treat additions of build step, bundler, lint, framework, or backend as scope creep — confirm with the user.

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

Tests live in `__tests__/lib.test.js` and load `lib.js` via `node:vm` so the same file can stay browser-loadable. DOM-bound code in `app.js` has no unit tests — verify those changes by reloading the browser and walking the flow with the bundled sample CSV (`KakaoTalk_Chat_[실밸개발자] 바이브코딩 클럽_*.csv`, ~27k rows / 3.1MB). Note the TDD-guard interaction below: editing `app.js` will be blocked until it has a test file or is exempted.

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

## TDD guard hook

`.claude/settings.json` registers a `PreToolUse` hook (`.claude/hooks/tdd-guard.sh`) that runs before every Edit / Write / MultiEdit tool call and **denies** the call when an implementation file has no discoverable test.

**Triggers on**: `.js`, `.jsx`, `.ts`, `.tsx`.

**Test discovery paths** (checked relative to the edited file):

- sibling `<base>.test.<ext>` / `<base>.spec.<ext>`
- `<dir>/__tests__/<base>.test.<ext>` / `<dir>/__tests__/<base>.spec.<ext>`
- `<parent>/__tests__/<base>.test.<ext>` / `<parent>/__tests__/<base>.spec.<ext>`
- `<repo-root>/src/__tests__/<base>.test.<ext>` / ...spec.<ext>

**Exempt** (never denied): `*test*` / `*spec*` paths; `.json` / `.css` / `.scss` / `.md` / `.yml` / `.yaml` / `.env*` / `*.config.*`; `types/`, `*.d.ts`; Next.js routing files (`layout.tsx`, `page.tsx`, etc.). Anything else with a non-JS extension (e.g. `.html`) is not matched by the trigger and passes through.

**Repo layout**: Tests live in `__tests__/` so the hook's `<repo-root>/__tests__/<base>.test.js` lookup succeeds for `lib.js`. Vitest auto-discovers this directory.

**Open item — `app.js`**: `app.js` has no unit tests (DOM glue, not unit-testable as-is) and the hook will deny edits to it. When you next need to edit `app.js`, pick one and apply it consciously:

- Add an `app.js` exemption in `.claude/hooks/tdd-guard.sh` (case list).
- Add a stub `__tests__/app.test.js` that imports nothing — only satisfies the discovery check.
- Extract the bit you're changing into `lib.js` (drives logic toward the tested module).

## Git hygiene

- `.env` is gitignored (`.gitignore:31`). Always stage files explicitly (`git add app.js index.html ...`) — never `git add .` — to keep `.env` accidents impossible by habit.
- All `*.csv` are gitignored (`.gitignore:71`). The bundled sample CSV exists in the working directory but is not tracked; do not force-add it.
