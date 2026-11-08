# BuildPilot → "Your Claude Code Companion" (v0.12 plan)

Source: the owner's "Universal Claude Code Companion" prompt (2026-11-08) merged with the expert review of v0.11.0 (same day).
Positioning: **BuildPilot — your Claude Code companion. Know what Claude is doing. Know when it needs you. Know what to do next.**

## Decisions taken (owner can overrule)
- **Name stays BuildPilot.** The prompt says "Pilot"; renaming breaks the installed plugin id `buildpilot`, the repo, the site and the license Worker. Tagline adopted.
- **Plugin first.** VS Code extension kept but secondary; every "Open BuildPilot" goes to `bp ui` / the widget, never VS Code.
- **Widget = the existing SwiftUI BuildPilot Bar** (no new stack), plus an optional floating panel (compact/expanded, non-activating, never takes focus, off by default, always-on-top optional).
- **Event-driven, local-only.** No new telemetry. No AI calls by default.
- Tests never show windows (owner rule): headless Chrome, hidden panels.

## Verified against the official hooks docs (code.claude.com/docs/en/hooks, 2026-11-08)
- Common input: `session_id`, `prompt_id` (UUID per user prompt), `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `agent_id`/`agent_type` for subagents.
- `Stop`/`SubagentStop` carry `last_assistant_message`. `SessionStart.source` (startup/resume/clear/compact/fork), sometimes `model`.
- Events available beyond what we use: `TaskCreated`, `TaskCompleted`, `PostCompact`, `PermissionDenied`, `CwdChanged`, `WorktreeCreate/Remove`, `PostModelSwitch`.
- `async: true` runs in background; timeout not enforced for async hooks.

## Phase A — trust (the numbers must be right)
1. Dedupe = payload hash **+ 5-second time bucket** (keeps plugin+settings double-fire merged, keeps genuine repeats).
2. Spool watcher: ignore its own `.alive`/`tmp` writes; throttle drains (≥250 ms).
3. Spool cap: lifecycle events (Stop, StopFailure, SessionEnd, PermissionRequest, Notification, UserPromptSubmit, SessionStart) are always written; only tool events are dropped past the cap.
4. DB: set `busy_timeout` before WAL; quarantine only on real corruption (SQLITE_CORRUPT/NOTADB); never let a sql.js process write a file that a node:sqlite/WAL process uses (read-only fallback).
5. Subagent events (`agent_id`) never change the parent's status; a late async tool event can't override Stop/StopFailure/SessionEnd unless a newer prompt (different `prompt_id`) started.
6. "Hide idle" sessions come back on new activity.
7. Errors = real failures only (failed tool call, failed tests/build, StopFailure, repeats). Plain non-zero exits stay in the timeline.
8. Tests: the folder status counts tests run in any Claude session (test commands seen in events), not only ones BuildPilot ran.
9. One number per metric across window / CLI / widget (shared function).
10. Prune hourly; prune old sessions and status files.

## Phase B — security
- Server actions validate paths: `dir` must be a known side build; files must be inside the current project.
- UI token moves out of the query string (fragment → cookie handshake).
- Redaction: `user:pass@` URLs, hyphenated key headers, `--password x`, `-pSecret`.
- Alerts deduplicated across VS Code, `bp ui` and the widget (shared sent-record in the DB).

## Phase C — the four questions
1. **What is Claude doing?** Current task = latest prompt (one line), plus Claude's own checklist: `TodoWrite` inputs and `TaskCreated/TaskCompleted` → "Step 3 of 7 · Adding login". Observed, never estimated.
2. **Stuck, failing, waiting?** Statuses: Working, Needs approval, Needs your answer, Your turn, Finished, Failed, Unknown. "May be stuck" when one step runs unusually long. Session ended unexpectedly → shown.
3. **What next?** One primary next step per session and one overall, with a copyable prompt or safe action.
4. **Is it progressing?** "Claude finished" vs "Verified": tests/build/lint seen passing after the last edit. Checklist progress shown as observed counts.
- Context health: colour by level, "Start fresh" on the row from 70 %, compaction shown, 200k vs 1M window from the status line.
- Cost: dollar estimate per session/day when the status line provides it (labelled estimate); plan limits stay.
- Risky-change signals: tests deleted/weakened, `.env`/secret files edited, destructive commands (`rm -rf`, `git push --force`, `git reset --hard`), large diffs.
- Daily overview: `bp today` + top of the window (active projects, needs-you, finished today, blockers, next step).

## Phase D — UI
- One vocabulary everywhere: **session**, **memory % full**, status words above.
- One warning threshold set: memory 70 / 90, limits 80 / 95.
- Window: fixed row grid, task + checklist line on the row, chevron to expand, collapse repeated steps, plain tool names, two columns ≥1000 px, prompt box collapsed, j/k/Enter/n keys.
- "Go to tab" on every row (tty recorded by the hook, matched by session).
- Widget: own template icon; floating panel compact (most urgent session + next step) / expanded (all sessions); open → `bp ui`.
- Glance/`bp`: no jargon ("stage implementation (inferred)" removed).

## Phase E — plugin & distribution
- `/bp-doctor` (diagnose + repair), `/bp-status` summary inside Claude, `/bp-today`.
- Plugin warns once when settings.json hooks also exist (double install) — already present, keep.
- README: two install paths (plugin only; plugin + Mac widget), uninstall, data & privacy, limitations.
- CI check that `plugin/bin/cli.js` equals the built CLI.

## Definition of done
`npm run ci` green; new unit tests for every Phase A item; a live two-session run captured correctly; install/uninstall in a sandbox HOME; headless screenshots reviewed; docs updated; nothing published without the owner.
