# Progress (2026-11-08)

## v0.12.0: your Claude Code companion (branch `companion`, tag `pre-companion-v0.11.0` = rollback point)
- Plan: docs/COMPANION_PLAN.md (owner's companion prompt + the v0.11 expert review). Phases A (trust), B (security), C (four questions), D (UI), E (plugin/docs) done; see CHANGELOG.
- 194 tests pass (typecheck + lint clean). Window checked with headless screenshots on live data (light, dark, expanded, 800 px).
- Not installed: `~/.buildpilot/bin`, the plugin and the widget still run 0.11 on the owner's Mac (hook.sh was refreshed to 0.12 by a CLI run). To install: `npm run build && node plugin/bin/cli.js shell install && node plugin/bin/cli.js doctor --fix` (+ `bash scripts/build-widget.sh` and `bp bar install` for the widget).
- Not pushed / not merged to main.

## v0.11.0: works for more Claude Code users (current, not yet committed/pushed)
- From the expert review (7/10): plugin ships `sql-wasm.wasm` (Node 18–22.4 no longer crash), `plugin/bin/bp.sh` gives one plain line when Node is missing, spool clock starts on first event + 2000-event cap + owner-only files, `/bp-terminal` for plugin-only users, Windows (wt/cmd) and more Linux terminals, standalone dark page that follows the system (AA contrast, tested), min text 12px, double-hooks tip with one-click fix, action column no longer overlaps chat % in the VS Code layout.
- Website no longer says "Open source" (LICENSE is proprietary); it says "Source on GitHub" and lists Node 18+ / Mac-first.
- `npm run ci` no longer runs the smoke test (it opens a visible VS Code window); use `ci:full` only when the owner agrees.
- 155 tests pass. Verified in sandbox homes: older-Node path, no-Node message, spool cap, stale clock, `/bp-terminal`. Dark/light/VS Code layouts checked with headless screenshots.
- Not done: the owner's installed `~/.buildpilot/hook.sh` + `bin/` still run 0.10 (refresh: `node plugin/bin/cli.js hooks install && node plugin/bin/cli.js shell install`). Windows/Linux terminal launching untested on real machines. License terms (proprietary vs source-available) are the owner's call.

## v0.10.0: clearer, calmer window
- Tested as a user against live sessions: opened the window, expanded a build, searched for a file, wrote a prompt, opened Advanced tools. No JS errors.
- Plain-English activity and steps, full-width details, file finder behind a link, aligned columns. 143 tests plus smoke pass.
- Installed: `~/.buildpilot/bin` + media, VS Code 0.10.0, Desktop folder + `~/Desktop/BuildPilot.app`. The public plugin installs as 0.10.0 from GitHub (checked in a scratch config).
- Still needs the owner: the Stripe webhook secret + a test purchase, then a live Payment Link.

## v0.6.0: power-user release
Live action + errors per build, token breakdown from transcripts, Codex (read-only), notifications in the standalone app, find the right Terminal/iTerm tab, many-session handling (groups, names, stopped mid-task, clear quiet), who-changed-this-file + undo, weighted forecast and weekly pace. See CHANGELOG.


## State: v0.5.0, one white page, Free/Pro with a trial, Claude Code plugin, license Worker, persona-tested (3 rounds × 8 user types)
- Sidebar replaced by one page (`src/extension/sidebar.ts` → BuildPilotPanel). Data: `src/core/page.ts`, `tips.ts`. Plans: `license.ts`. Counts: `counts.ts`.
- Plugin in `plugin/`, validated and installed in a scratch config (events captured). Worker in `server/`, tested; **not deployed** (needs Stripe + Cloudflare).
- Persona results: docs/PERSONA_REVIEW.md. Every user type scores at least 4/5 on usability; willingness to pay is 2.5/5. Real-user plan: docs/VALIDATION.md.
- Needs the owner: Stripe Payment Link, Cloudflare deploy, publisher accounts, a public GitHub repo for the plugin marketplace (docs/PUBLISHING.md).

# Earlier (2026-11-05)

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
