# Testing & verification

Run everything: `npm run ci` (typecheck → lint → unit/engine tests → real VS Code smoke test).

## Results (2026-11-05, macOS, Node 22.22, VS Code installed, Claude Code 2.1.318)
| Gate | Result |
|---|---|
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) | ✅ clean |
| ESLint (typescript-eslint recommended) | ✅ clean |
| Vitest: 83 tests (core, engine, features, webview, accessibility, widget data + sandboxed widget install/uninstall) | ✅ 83/83 |
| Menu-bar widget, real app: builds universal; live data in panel; sandbox session asking approval → icon label "needs you" within seconds (spool watcher); Start-at-login toggle writes/removes LaunchAgent; rows exposed as buttons to accessibility | ✅ manual, 2026-11-06 |
| Widget runtime fallback: CLI runs under VS Code's Electron (`ELECTRON_RUN_AS_NODE`, Node 24) | ✅ |
| Marketplace package validates (`vsce package`, 22 files, 921 KB) | ✅ |
| Extension-host smoke (`test/smoke`), real VS Code, isolated profile | ✅ 27/27 checks (incl. every contributed command registered, safe commands executed, Integration API + Pocket, status-line data) |
| Sidebar click-through (real bundle in jsdom): tabs, Prompt Studio build/copy/start, actions, memory, connect, XSS escaping | ✅ 12/12 |
| Exhaustive button sweep: every `data-act` button on all 6 tabs clicked; each posted message must have a handler in `extension.ts`; no runtime errors | ✅ (40+ distinct buttons) |
| Live re-render safety: typed text, ticked rollback files and keyboard focus survive state pushes | ✅ |
| CLI: every command and bad input (unknown command/goal/option → usage + exit 2) | ✅ manual, 2026-11-05 |
| Integration API live: 5 GET endpoints 200, no/bad token 401, bad JSON 400, unknown 404, Pocket 200 | ✅ manual, 2026-11-05 |
| Live `npm audit` on BuildPilot itself | ✅ found 2 critical + 1 high in dev tools → upgraded vitest 2→4 → 0 critical/high |
| Visual check with real headless Chrome screenshot against a local server; error-page detection | ✅ |
| Status-line script: saves data, chains an existing status line unchanged, restores exactly | ✅ |
| "Start in Claude Code" command: hostile prompt reaches `claude` as one exact argument, nothing executed | ✅ |
| Webhooks (ntfy + generic JSON) against a local receiver | ✅ |
| Live Claude Code integration (`claude -p` with project-scoped hooks) | ✅ 8/8 events captured and ingested; session linked to project; transcript usage format confirmed |
| VSIX packaging + install into isolated extensions dir | ✅ `buildpilot-local.buildpilot@0.1.0` |
| UI screenshots, dark + light, all 6 tabs at 340 px (`test/ui`) | ✅ reviewed |

## Coverage by requirement
- Hook ingestion, duplicate/malformed events, multiple concurrent sessions, lifecycle transitions, out-of-order events: `ingestion` suite
- Unknown states / staleness: `supervisor › never claims a quiet 'running' session…`
- Migrations, persistence, corrupt DB: `database` suite
- Project switching & symlinked paths: `engine end-to-end`
- Git working-tree safety, checkpoint, scoped rollback, unsafe paths: `git safety`
- Context handoff & prompt generation: `prompt studio`, `engine › creates a handoff…`
- Permission/approval handling: lifecycle test + `emits a meaningful alert… only once`
- Missing Claude Code / hooks missing → recommendation: engine + smoke
- Secret redaction & untrusted content (README injection, path traversal in transcript paths): `redaction`, `repository analysis`, `transcript usage`
- Resource usage & event volume: 3000 events across 5 sessions in <15 s, pruning bounded
- Integration API auth: `serves the integration API only with a valid token`
- UI rendering & interactions: smoke (view opens, commands), screenshot harness (rendering in both themes)

## Demo vs. real data
`BuildPilot: Load Demo Sessions` inserts sessions with ids `demo-*`, shown with a DEMO label and banner, never alerting, removable in one click. The UI fixtures in `test/ui` come from the real engine plus demo sessions.

## Not run / limits
- Windows and Linux: not run (no machines here). Paths, shells (PowerShell/cmd/Git Bash) are handled in code but unverified.
- Webview inside VS Code itself isn't scriptable from the extension-host API; the same bundle is click-tested in jsdom and screenshot-tested in Chrome.
- Real ntfy/Slack/Discord endpoints and Anthropic/Ollama calls: formats tested against a local receiver; not sent to live services (needs your accounts/keys).
- Pocket on a physical phone / glasses audio: page verified rendering live data in Chrome; not tried on a real phone here.
- Remaining audit findings: 10 moderate, dev-only (typescript-eslint chain), fixed only by a major upgrade (ROADMAP #6).
