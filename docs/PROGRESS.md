# Progress (2026-11-05)

## State: v0.2.0, installed and connected on this Mac
- Extension installed in VS Code (`buildpilot-local.buildpilot@0.2.0`).
- Hooks + status line are in `~/.claude/settings.json` (backups in `~/.buildpilot/backups/`). Verified live: a new headless session was captured and linked; already-open sessions (including the one that built this) appeared without a restart; status-line data (context %, cost estimate, 5-hour limit) arrived for all 6 open sessions.
- Gates: typecheck, lint, 67/67 unit/UI tests, 25/25 VS Code smoke checks, VSIX packaged.

## Milestones
| # | Milestone | Status |
|---|---|---|
| 1 | Foundation | ✅ |
| 2 | Real session monitoring | ✅ live-verified |
| 3 | Project intelligence | ✅ |
| 4 | Guided development (Prompt Studio, memory, approvals, checkpoints) | ✅ |
| 5 | Quality & polish (loops, conflicts, exact context/cost, audit, visual QA, worktrees, beginner mode, packaging) | ✅ |
| + | Integrations (webhooks, Integration API, Pocket phone/glasses page, CLI) | ✅ (native glasses app ⏳) |

## Next actions
1. Reload VS Code (Developer: Reload Window), open a project, click the BuildPilot icon.
2. Optional: Connect tab → Set up notifications (ntfy app on your phone) and/or enable Integration API + Pocket.
3. Use it for a day; note wrong statuses or noisy recommendations. Then ROADMAP #1–2.

## Undo everything
`node dist/cli.js statusline uninstall && node dist/cli.js hooks uninstall`, then uninstall the extension in VS Code. Data: `~/.buildpilot/`.

## Checkpoint for the next session
Committed on `main`. `npm install && npm run ci`. Read `CLAUDE.md`, this file, `docs/FEATURES.md`.
