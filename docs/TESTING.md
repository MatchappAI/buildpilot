# Testing & verification

Run everything: `npm run ci` (typecheck → lint → unit/engine tests → real VS Code smoke test).

## Results (2026-11-05, macOS, Node 22.22, VS Code installed, Claude Code 2.1.318)
| Gate | Result |
|---|---|
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) | ✅ clean |
| ESLint (typescript-eslint recommended) | ✅ clean |
| Vitest: 39 tests (`test/unit/core.test.ts`, `test/unit/engine.test.ts`) | ✅ 39/39 |
| Extension-host smoke (`test/smoke`), real VS Code, isolated profile | ✅ 20/20 checks |
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
- Webview click-through automation inside VS Code: not automated (webview DOM isn't reachable from the extension-host test API); interactions were checked via the standalone harness, which uses the real bundle.
- Notifications to real ntfy/Slack endpoints and Anthropic/Ollama refinement: code paths written, not exercised against live services (would need your accounts/keys).
- "Start in Claude Code" terminal launch: exercised manually only via the CLI equivalent; the VS Code terminal path wasn't automated.
