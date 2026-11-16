# Final readiness report (2026-11-16, v0.12.4, branch `audit/2026-11-16`, not pushed)

## Score: 8 / 10 for the free product (CLI, window, plugin hooks, engine) · not ready to *sell* (no live checkout)
Evidence: `npm run ci` green (typecheck, lint, **254/254** tests); `npm run test:e2e` **34/34** window steps + **7/7** free-plan steps, run 3× green after the last fix; CLI/edge sweeps (~110 checks) in throwaway homes; axe WCAG 2.2 AA: 0 violations; 20,020-event database answers in ≈0.1 s. The owner's real `~/.claude/settings.json`, `~/.buildpilot` and widget were never touched (settings hash unchanged; all runs used a throwaway HOME).

## What was fixed (27 issues; details in ISSUE_TRACKER.md)
- **P0** — `/bp-prompt` could run shell commands hidden in a plain-English request (backticks / `$(…)`); now passed on stdin.
- **P1** — same quoting problem in four more slash commands · confirmations ("Connected", "Merged"…) vanished instantly · `bp ui` could stop an unrelated app via a stale pid file.
- **P2** — Cancel still used up a free prompt · Review/Merge didn't appear until a click · theme toggle saved the wrong value · grey page (owner wants white) · raw unreadable events (possible secrets) kept forever · `bp doctor --json` · stale "Connect" hint · project picker accepted any folder.
- **P3** — 13 smaller ones (names in `bp glance`, quoting in hints, Git-missing message, real API port, prompt file cleanup, "Go to tab" feedback, test seam for OS actions, wording).

## Still not verified / blocked
- Menu-bar widget + floating panel: not run (it would appear on screen). Data feed verified.
- VS Code extension host smoke (`npm run test:smoke`): not run (opens VS Code). Same page bundle passes in jsdom.
- Slash commands inside a real Claude Code session: not run (would write into the owner's real data / cost API usage). Command files + `bp.sh` tested directly.
- Windows / Linux: not run.
- Pro purchase: Stripe Payment Link is still a placeholder, so Pro is unlocked for everyone ("not on sale"). License Worker left untouched (live).

## Needs the owner
1. Review and push `audit/2026-11-16` (5 commits), then merge to main.
2. Reinstall to get the fixes on this Mac (not done, by instruction): `npm run build && node plugin/bin/cli.js shell install && node plugin/bin/cli.js doctor --fix`; refresh the plugin from the marketplace after pushing; the running window server restarts itself on the next `bp ui` (version check).
3. OK to run `npm run test:smoke` (visible VS Code) if wanted.
4. Stripe Payment Link + webhook secret when ready to sell.

## Top next improvements
1. A real-Claude-Code plugin check in a sandbox config dir (needs an API key budget).
2. Widget: an off-screen render test (`showInactive`-style) so it can be verified without showing a window.
3. `bp visual` / bad-JSON responses: proper exit code / 400.
4. Faster "Go to tab" (cache the claude process list for a few seconds).
