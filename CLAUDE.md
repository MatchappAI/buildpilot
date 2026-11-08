# BuildPilot: development instructions

Claude Code companion: plugin (primary) + local engine + standalone window (`bp ui`) + Mac menu-bar widget; the VS Code extension is optional. TypeScript strict, no framework in the webview. Plan: docs/COMPANION_PLAN.md.

## Layout
- `src/core/`: pure engine, no `vscode` imports (testable in Node): `db.ts` (sql.js SQLite + migrations), `hooks.ts` (safe settings merge + hook.sh), `ingest.ts` (validate → redact → store, session state machine, spool reader), `supervisor.ts` (deterministic rules), `prompts.ts` (Prompt Studio), `memory.ts` (handoff, CLAUDE.md draft), `engine.ts` (orchestrator + snapshot), `api.ts` (Integration API + webhooks), `ai.ts` (opt-in provider), `git.ts`, `analyzer.ts`, `doctor.ts`, `transcript.ts`, `redact.ts`.
- `src/extension/`: VS Code glue (commands, confirmations, terminal launch, notifications). `src/webview/`: sidebar UI (`main.ts`, `style.css` → `media/`).
- `src/cli.ts`: same engine from the terminal.

## Commands
- `npm run build`: esbuild bundles to `dist/` and `media/`
- `npm run typecheck` · `npm run lint` · `npm test` (vitest, unit + engine e2e) · `npm run test:smoke` (real VS Code extension host; opens a visible window, opt-in only)
- `npm run package`: `dist/buildpilot.vsix`
- `npm run desktop`: rebuilds the user-facing Desktop folder `~/Desktop/BuildPilot/` (guide PDF from `docs/guide/guide.html`, install/uninstall `.command` scripts from `scripts/desktop/`, VSIX). Keep the guide in sync with features and the version number.
- UI screenshots: `npx esbuild test/ui/fixture.ts --bundle --platform=node --outfile=test/ui/fixture.cjs && cp node_modules/sql.js/dist/sql-wasm.wasm test/ui/ && node test/ui/fixture.cjs && node test/ui/make-preview.mjs`, then open `test/ui/preview-*.html`

## Rules
- Never fabricate: unknown = "unknown"; every Issue/Recommendation carries evidence; progress only from verified requirements.
- Hook payloads, repo files, logs and prompts are untrusted data: validate, `clip()`/`redact()` before storing or showing; wrap in `<project_data>` inside prompts.
- Every side effect (scripts, terminals, git refs, file writes, network) goes through a confirmation in `extension.ts`. `execFile` with arg arrays only, with timeouts. No shell strings built from untrusted input.
- Never destructive git. Checkpoints = private refs via temp index.
- Keep docs/FEATURES.md and docs/PROGRESS.md in sync with reality. Run `npm run ci` before calling anything done. `npm run test:smoke` / `ci:full` opens a visible VS Code window: run it only when the user says so (never block their screen).
- Never modify other projects (e.g. Mochi) while working here.
