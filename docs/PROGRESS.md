# Progress (2026-11-05)

## State: v0.3.2, full review pass done; installed and connected on this Mac; Desktop folder delivered; BuildPilot shows in every terminal

### v0.3.2 review pass (every button, command and CLI path exercised)
Fixed: Disconnect removed the status line even if you then cancelled · Escape on the checkpoint/worktree name prompt still created it · live updates (every hook event / 30 s) wiped half-typed text in Memory and ticked rollback files, and dropped keyboard focus · no visible feedback for Copy/Save/Add (now a short toast, also announced to screen readers) · empty "Add requirement/decision" did nothing silently · "Add" acceptance criteria now inline with Enter/Escape · Enter submits in Memory and the app-address field · Sessions tile ignored demo sessions the badge counted · "What's happening?" said "not connected" while sessions were shown · high/critical vulnerabilities ranked only "Worth doing" (now Important) · approval/input recommendations had no button (now "See the session") · "file(s)"-style plurals · `bp prompt` with no/unknown goal silently built a feature prompt (now usage + goal list) · `bp hooks/statusline/shell` printed raw objects (now plain sentences; `--json` for scripts) · handoff said "0 min ago" · terminal-copied "❯" prefix in task names · empty request left a misleading placeholder · re-render skipped when nothing changed.
- Extension installed in VS Code (`buildpilot-local.buildpilot@0.3.2`) via the Desktop installer.
- `~/Desktop/BuildPilot/`: `1 - START HERE.pdf` (15 pages), `2 - Install BuildPilot.command`, `3 - Uninstall BuildPilot.command`, `BuildPilot 0.3.2.vsix`. Rebuild with `npm run desktop`.
- Hooks + status line are in `~/.claude/settings.json` (backups in `~/.buildpilot/backups/`). Verified live: a new headless session was captured and linked; already-open sessions (including the one that built this) appeared without a restart; status-line data (context %, cost estimate, 5-hour limit) arrived for all 6 open sessions.
- Gates: typecheck, lint, 81/81 unit/UI/accessibility tests (incl. a sweep that clicks every button), 27/27 VS Code smoke checks, VSIX packaged; install/uninstall scripts sandbox-tested (~/.zshrc restored byte-for-byte; Claude settings restored with identical content, re-indented as Claude Code itself writes it).
- Storage: node:sqlite in WAL mode, so multiple windows plus the terminal share one DB safely (tested: 2 engines, 400 events, each recorded once).

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
Double-click `~/Desktop/BuildPilot/3 - Uninstall BuildPilot.command`.

## Checkpoint for the next session
Committed on `main`. `npm install && npm run ci`. Read `CLAUDE.md`, this file, `docs/FEATURES.md`.
