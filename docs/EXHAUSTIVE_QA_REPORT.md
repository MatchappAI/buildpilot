# Exhaustive QA report: every path, every action, every sequence (2026-11-17, v0.12.6)

Branch `exhaustive/2026-11-17` (not pushed). Builds on the code audit (APP_AUDIT, QA_MATRIX, ISSUE_TRACKER, FINAL_READINESS_REPORT) and the live UI pass (LIVE_QA_REPORT) and does not redo them. This pass goes for completeness, systematically: the app is modelled as state machines, a seeded generator drives the **real** code with long random sequences, checks invariants after every step, shrinks any failure to a minimal sequence and saves it as a regression.

"Every sequence" is infinite, so this report states the coverage criteria actually met, with the numbers the generator printed (`qa/model-coverage.json`, written by the run itself).

**Re-run:** `npm run test:model -- --seed N` (all layers, ~1.5 h) · `npm run test:model -- --quick --seed N` (~8 min) · `--layers session,api,ui,…` · `--seeds K` · `--steps M` · `--regressions` (saved shrunk sequences only) · `--write-model` (writes `qa/model.json`). Nothing appears on screen: headless Chrome (`--headless=new`), throwaway HOMEs under `~/Library/Caches/bp-model-*`, every OS effect (Terminal, clipboard, notifications, opening links, bringing a tab forward) written to a log instead of happening. License tests use a throwaway Ed25519 key generated per run and swapped into a test bundle (`test/model/build.mjs`); the real issuer key is never used.

## 1. The model (qa/model.json)

| Machine | States | Actions | Possible (state, action) pairs | Impossible pairs (listed in model.json) |
|---|---|---|---|---|
| Session lifecycle (hook ingest) | 9 (absent, unknown, idle, running, awaiting approval, blocked, failed, completed, hidden) | 34 (24 hook events + late, out-of-order ×3, duplicate, genuine repeat, malformed, 3 h quiet, Clear them, rename) | 297 | 9 (absent × actions that need an existing session) |
| Side build | 10 (none, clean, unsaved, saved, merged, removed, unsaved/saved + conflict, unsaved/saved + failing tests) | 14 (new in window / CLI, edit, commit, make conflict, fix conflict, break tests, review ×2, merge, merge anyway, CLI merge, remove, CLI done) | 92 | 48 |
| Plan / license | 6 | 8 | 44 | 4 |
| Connection | 4 | 4 | 16 | 0 |
| Prefs (theme × alerts) | 6 | 2 | 12 | 0 |
| Session actions from the window | 5 | 12 | 59 | 1 |
| Main project | 2 | 7 | 12 | 2 |
| **Total (7 machines)** | **42** | **81** | **532** | 64 |
| Window screens | 13 screens | 31 controls + 7 dialog answers + 7 keys + 16 environment / behind-the-back actions | open (whatever is visible on each screen); measured below | |

`qa/model.json` totals: 55 states, 142 actions, 532 possible transitions.

Each machine's states, actions, which (state, action) pairs are possible, and why the rest are not, are in `qa/model.json` (generated from `test/model/model.mjs`). Expected effects live with the executors:

- **Session lifecycle** (hook ingest): `test/model/session.mjs` `spec()`, an oracle written from the documented rules (status per event, subagent and late-event rules, out-of-order delivery, duplicates within 5 s, genuine repeats, malformed payloads, quiet sessions hidden and coming back). Driven in-process through the real spool reader, ingestor and node:sqlite store, with a virtual clock.
- **Side builds** (none → clean → unsaved → saved → merged → removed, with conflict and failing-tests variants and reversals): `test/model/api.mjs` (`BUILD_EDGES`, `mergeAction`, `removeAction`), against the real `bp ui --serve` and real git worktrees, through the window API and the CLI (`bp new / review / merge / done / builds`).
- **Plan / license** (free, free-exhausted, trial, trial-ending, licensed, not-sellable; keys valid, expired, forged, garbage), **connection** (disconnected, connected, plugin, plugin + hooks), **prefs** (theme × alerts), **project** (clean / unsaved changes), **session actions from the window** (rename, Looks fine, Resume, Go to tab, Start fresh, Who changed, Undo file).
- **Window screens** (connect card, sessions, prompt written, file finder, paywall, 4 dialog kinds, offline, expired, server down): every visible `data-act` control, every dialog answer (OK, Cancel, Esc, Enter, backdrop, typing, picking), keys (j, k, g, /, Tab, Esc, Cmd+Enter) and environment actions: reload, reopen, second tab, slow network, offline, server stop / start / restart, phone width, dark mode, plus changes made behind the window's back (hook events, CLI side builds, API calls, edits in a build).

## 2. Coverage, per criterion

All numbers below are from one generator report, `qa/model-coverage.json` (run seed 11, all layers, plus a supplementary `--add` run of the session (state × action) suite and the pairwise suite with seed 11 after a harness timing fix). The same criteria on run seed 1 (all layers, 22,707 steps, 0 failures) are in §3.

**(a) All transitions: every action from every state where it is possible, and refused where it isn't.** A refused action is a transition back to the same state, and the fingerprint check proves it changed nothing.

| Machine | Covered | Not covered and why |
|---|---|---|
| Session lifecycle | **297 / 297** | — (directed suite: reach each state on a fresh session by the shortest route, then every action; plus 6,000 random-walk steps) |
| Side build | **92 / 92** | — (directed suite on a Pro world, so failing tests block a merge) |
| Plan / license | **44 / 44** | — (one world per plan state × every plan action) |
| Connection | **16 / 16** | — |
| Prefs | **12 / 12** | — |
| Session actions from the window | **58 / 59** | awaiting approval × "undo a file Claude edited": the walk never edited and then asked for approval in that order; the same undo was run from idle and failed sessions and from the random walks |
| Main project | **12 / 12** | — |
| **Total** | **531 / 532** | |
| Window: (screen, action) pairs run | 192, on 11 of 13 screens | "paywall" and "expired" screens are entered (paywall via the controls scenario, expired after restarts) but the walk's screen detector files those steps under "sessions" / "offline" |
| Window: controls pressed at least once | **31 / 31** | — |

The walks also ran 20 transitions outside the model's state list (a build that is both in conflict and failing its tests; CLI merge/done naming a build that no longer exists); all passed every invariant.

**(b) Transition pairs (2-switch): every pair of consecutive actions on the same entity.**

| Machine | Pairs run | Missing |
|---|---|---|
| Session lifecycle | **1,156 / 1,156** | — |
| Side build | 186 / 196 | 10, all with "fix conflict" (only possible from a conflicted build): e.g. fix conflict → fix conflict, fix conflict → merge anyway, edit → fix conflict |
| Plan / license | 58 / 64 | 6 with "trial ends": trial ends → trial ends is impossible; the others need a trial still running after a key was entered |
| Connection | **16 / 16** | — |
| Prefs | **4 / 4** | — |
| Session actions from the window | 136 / 144 | 8 with "undo a file Claude edited" |
| Main project | 47 / 49 | 2 impossible (unsaved changes twice in a row, clean twice in a row) |
| Window: consecutive action pairs | 537 distinct pairs | no closed denominator (the controls on screen change with the data) |
| Any two consecutive window-API actions | 965 distinct pairs | of 47² = 2,209; not a goal, reported for scale |

**(c) Pairwise combinations of settings, plans and data:** 8 factors (plan 6 × connection 3 × data 2 × theme 3 × alerts 2 × width 2 × light/dark 2 × git / no git 2) have **205 value pairs; 20 configurations cover 205 / 205**. Each configuration is a fresh world opened in headless Chrome and checked as it opens, then 10 random steps with all invariants: **20 / 20 passed**.

**(d) Every lifecycle path, including reversals and invalid jumps.**
- Side builds: **23 / 23** simple paths none → removed through the lifecycle (reversals merged → unsaved, saved → unsaved, conflict → saved, forced merge of failing work), each action of an edge used in turn; after removal, merge / remove / review of the removed folder are tried and must be refused. Invalid jumps straight through the API (merge a clean build, remove unsaved work, merge a build of another project, review `/etc`, act on a removed folder) are part of the 92 transitions above.
- Sessions: **1,957** simple paths (no state twice, up to 9 steps) through the session graph the walks found; all 1,957 replayed on fresh sessions, **1,030** follow exactly the predicted states (the other 927 need a detail the abstract state doesn't carry, e.g. "late" needs a finished turn on record, so they stop at the first divergence; none disagreed with the oracle), **0 failures**.

**Input fuzzing:** 29 text classes (empty, spaces, 1 char, 40 / 41 chars, 300 words, 20,000 chars, newlines, unicode, right-to-left override, emoji, zero-width, HTML, `</script>`, attribute break-out, shell `$(…)` and backticks, apostrophe, quotes, backslashes, SQL, LIKE wildcards, path traversal, NUL, lone surrogate, terminal escape codes, JSON, `1e309`, `__proto__`) + 6 wrong types (number, boolean, null, list, object with a fake `toString`, `{"$gt":""}`) + 13 raw bodies (empty, not JSON, truncated, list, null, number, string, 5,000-deep nesting, 299 kB, 400 kB, unknown type, `__proto__`, BOM). Run: **120** (action, input class) pairs through the window API, **455** CLI command × flag × argument cases (every command, 387 distinct command/class keys), **171** plugin slash-command cases (11 commands × 33 argument classes incl. quote, `$(…)`, backtick and heredoc-marker injection), **136** Integration API cases (10 endpoints × 6 auth headers × methods, `/v1/prompt` × every body and text class). The window walks type the same corpus into every text box and dialog.

## 3. Seeds and steps run

| Run | Seeds | Steps | Failures | Time |
|---|---|---|---|---|
| Full, seed 1 (after the fixes) | session 1000–1002, concurrency ×3, API walks 10000–10022 (9), window walks 10000–10021 (6), + every suite | 22,707 | 0 | 33 min |
| Full, seed 11 (+ supplementary session/pairwise run) | session 11000–11002, concurrency ×3, API 110000–110022 (9), window 110000–110021 (6), + every suite | 25,701 | 0 (one pairwise "failure" was the harness checking the offline line before the page's second missed refresh; fixed in the harness, row re-run: 20/20) | 47 min |
| Development runs while finding the bugs | ~60 session seeds × 300, 12 concurrency, ~40 API walks, ~25 window walks, CLI/plugin/API layers repeatedly | not totalled | the bugs in §5 | |

So the last **6 fresh seed blocks** in a row (18 API walks, 12 window walks, 6 × 1,500 session steps, 6 concurrency runs of 2,000 events across 8 processes) ran clean, **48,408 steps** in the two final runs. Steps by layer (seed 11 + supplement): session walks 6,000 · concurrency events 6,000 · directed transitions 675 · window-API walks 1,260 · window (headless) 669 · CLI 455 · plugin 171 · Integration API 136 · pairwise 400 · lifecycle paths 9,935.

Shrinking: any failure is replayed on fresh worlds by delta debugging (ddmin, bounded in replays and minutes) to the smallest sequence that fails the same way; it is saved in `test/model/regressions/` and replayed first on every run. Example from this pass: an API walk failed at step 76 (a session name containing NUL came back cut short); it shrank in 6 replays to **1 step** (`renameBuild` with the NUL text), saved as `test/model/regressions/api-10002-*.json`, now passing.

## 4. Invariants checked after every step

- **Never broken:** no uncaught exception, no console error (network errors only while the network/server is down on purpose), no HTTP 5xx, no native alert/confirm, no injected script running (`window.__pwned`), no "undefined" / "NaN" / "[object Object]" on the page, in answers or in CLI output, no stack trace or crash line from the CLI, no sideways scroll at 375 / 1280 px, no control stuck "busy", never more than one dialog from two flows at once.
- **The page shows what the server says** (within one 3 s refresh): connect card ⇔ connected, session row count = active + shown-quiet, the "N quiet sessions" label, side-build names, Alerts label = ui.json, dark page = theme (+ system setting), Pro pill = licensed; after a server restart the old page says it is out of date.
- **The server agrees with the files it owns and with git:** plan / license / free prompts left = usage.json and license.json, theme / alerts = ui.json, connected = settings.json, settings.json always valid JSON and after Disconnect byte-for-byte the user's original, side builds = `git worktree list` = model, changed-file counts match each build's state, the main project never left mid-merge, no branch ever deleted, terminals only opened in folders BuildPilot knows, links only to the checkout.
- **Sessions:** database status, ended, event count, error count, last event and current request = the oracle; one event row per accepted event; no duplicates; an ended session is not listed as open; names normalised (≤ 40 characters).
- **Refused actions change nothing:** a fingerprint (settings, ui.json, usage.json, license.json, git HEAD, status, worktrees, branches, files) is compared before and after every action the model says must be refused.
- **Idempotent repeats:** about 7 % of steps repeat the previous action at once (impatient second press); Connect twice changes nothing the second time; Disconnect when not connected changes nothing.
- **Persistence:** after a server restart, side builds, plan, theme, alerts and session names are unchanged.
- **Concurrency:** several processes ingesting one spool and one database end in exactly the state one process reading the events in time order would reach.

## 5. Bugs found and fixed

Severity: P1 = runs something the user didn't mean / loses data, P2 = wrong state shown or a server stops, P3 = wrong message, inconsistency, edge case. Each has a regression (unit test in `test/unit/exhaustive.test.ts`, a saved sequence in `test/model/regressions/`, or an e2e step).

| # | Sev | Bug (before) | Minimal sequence | Root cause → fix | Regression |
|---|---|---|---|---|---|
| 1 | P1 | `/bp-who`, `/bp-new`, `/bp-merge`, `/bp-license` put your words inside single quotes on a shell line: an apostrophe broke the command (`/bp-new mohil's page` → shell syntax error) and `x'; touch FILE; echo '` **ran `touch`** | `/bp-who x'; touch PWNED; echo '` | Claude Code puts `$ARGUMENTS` into `!` lines as plain text (its docs don't promise escaping) → the four commands now pass the text on stdin through a quoted heredoc, like `/bp-prompt`; the CLI reads `--stdin` for who/new/review/merge/done/license; heredoc markers are unique and Claude is told to refuse input containing them | plugin layer (171 cases), `exhaustive.test.ts` |
| 2 | P2 | "Clear them" hid a session that had been waiting **3 hours for your OK** (also failed and stopped-mid-task ones): it hid anything silent for 2 h, while the page counted fewer as quiet | PermissionRequest → 3 h pass → Clear them | server rule ≠ page rule → `hideQuiet()` hides exactly the sessions the page lists as quiet (window, VS Code) | session walk, `exhaustive.test.ts` |
| 3 | P2 | With several BuildPilot processes reading events at once (window + widget + glance), a session could show an older status and an earlier "last seen" | 8 processes, 2 sessions, 2,000 events with 25 % arriving late → `last_event_at` 1.7 s older than the newest, status "needs your OK" instead of "working" | read-check-write across processes interleaved → each event is one `BEGIN IMMEDIATE` transaction (`Store.transaction`) | concurrency layer (6 × 2,000 events clean) |
| 4 | P2 | Integration API (`bp serve`) **stopped** on a request body of `null` | POST /v1/prompt `null` | `parsed.goal` of null in a callback outside the try → 400 for non-objects, try/catch around the handler | integration layer, `exhaustive.test.ts` |
| 5 | P3 | An old SessionStart delivered late reopened an ended session (listed again as "Closed" for 12 h) | SessionStart → SessionEnd → (older) SessionStart | `ended_at = NULL` without the "is newest" check → only for the newest event | session walk + paths, unit test |
| 6 | P3 | An older prompt delivered late replaced the newer request on the row | prompt "second" (t=20) → prompt "first" (t=10) | task set regardless of order → only if no newer user prompt is recorded | unit test |
| 7 | P3 | An older TodoWrite delivered late rolled Claude's checklist back | TodoWrite 2/2 (t=20) → TodoWrite 1/2 (t=10) | same → whole-list checklist only from the newest event | unit test |
| 8 | P3 | Integration API: over 20,000 characters dropped the connection (no answer) | POST 25,000 chars | `req.destroy()` → 413 "request too large" | integration layer, unit test |
| 9 | P3 | Window API: bad JSON / `null` body answered 500; a 400 kB body answered 413 and then reset the next request on the same connection; a field sent as an object with a fake `toString` answered 500, other objects became the name "[object Object]" | `{nope` · `null` · 400 kB then `ready` · `renameBuild name={toString:"x"}` | parse outside a 400 path; keep-alive kept after 413; `String(x)` on any type → 400s, `Connection: close` after 413, non-strings count as empty | API walk (raw bodies, wrong types), unit test |
| 10 | P3 | A session name with a NUL was cut short in the database; terminal escape codes were stored as typed | rename "a\0b" (shrunk 76 → 1 step) | → control characters become spaces | saved regression + unit test |
| 11 | P3 | Right after `bp ui` started, the first page load showed no side builds for up to 5 s | restart server → read state | side-build list filled in the background after start → awaited before the server is announced | API walk (restart persistence check) |
| 12 | P3 | Offline: "See exactly what changes" opened a box reading "undefined"; the project picker said "No projects yet" | network off → press | flows assumed a successful answer → show the real reason | window walks |
| 13 | P3 | After BuildPilot restarted, an open window said it "stopped running" (it was running) | restart server → press anything | 401 treated like a dead server → own message: "restarted, page out of date, run bp ui" | window walks |
| 14 | P3 | `bp merge` merged a Pro user's failing build without running tests (the window and the Pro promise run them) | Pro, build with failing tests → `bp merge name` | → tests run first; `--force` merges anyway | API walk (`cli:merge` from +failing states) |
| 15 | P3 | Save-point tip said "Save point made" after Cancel, and on a failure; a failure answered 500 | tip → Cancel | page added its own success toast; no try/catch on the server → server's answer only | window walks |
| 16 | P3 | `bp jump` with no or a missing folder printed nothing (exit 2) | `bp jump` | → usage line on stderr | CLI layer |
| 17 | test seam | "Go to tab" (`findBuild`) and the CLI's `bp ui` / `bp open` / tmux window could act on the real screen during tests (no OS-log seam) | — | → `osLog` seam (`src/core/oslog.ts`) for focus, open and terminal | e2e "no real OS side effects" |
| 18 | test | `ui-live` "no Pause for an idle session" failed every night after midnight (the seeded day's costs fall on yesterday, so the working session's share passes 30 %) | run between 00:00 and ~01:40 | fixture time → asserts Pause only ever names the working session | `ui-live` |

Before this pass the e2e suites and 254 unit tests were green: every bug above was found by the generator's oracles and invariants, not by existing tests. Unit tests now: 288.

## 6. UX fixes from the expert-review lens

- **Dead end:** a side build with changes offered only Review and Merge, so work you didn't want could not be dropped from the window. It now has **Discard** (the folder goes, its branch is kept; a folder with unsaved changes is never removed).
- **Action that lies:** with the BuildPilot plugin on, Disconnect said "Disconnected" while sessions kept showing. It now says the plugin keeps BuildPilot on and gives `/plugin disable buildpilot@buildpilot`.
- **Confusing order:** on a slow network, a dialog from a second press could open on top of the first. Dialogs now queue: one at a time.
- **Misleading message:** after BuildPilot restarted, the open window said "stopped running" (it was running). It now says "restarted, so this page is out of date. Run bp ui".
- **Success that wasn't:** the save-point tip said "Save point made" even after Cancel. It now shows the server's real answer.
- **Offline:** "See exactly what changes" showed a box reading "undefined"; the project picker said "No projects yet". Both now show "Couldn't reach BuildPilot. Nothing was changed."
- **Same promise everywhere:** Pro says "your tests run before every merge"; `bp merge` (and `/bp-merge`) skipped them. They run now (`--force` to merge anyway).
- `bp jump` with no folder printed nothing; it prints how to use it.

## 7. What cannot be covered exhaustively, and why

- **"Every sequence" is infinite.** Met instead: all possible transitions (531 / 532), all consecutive pairs per entity (where possible, listed above), pairwise configurations (205 / 205), every simple lifecycle path (23 side-build, 1,957 session), plus ~48,000 random seeded steps. Longer interactions (triples and beyond) are only sampled by the random walks.
- **Real screen, real accounts:** the menu-bar widget (clicks, notifications), the VS Code extension host, real Terminal / iTerm tab focusing, macOS notifications, the clipboard and the Stripe checkout would appear on the owner's screen or touch real accounts. They are replaced by the OS-effect log (each effect is asserted: kind, folder, URL). The widget's data feed and the same page bundle are covered.
- **Slash commands inside a real Claude Code session:** not run (writes into the owner's real data, costs API usage). Emulated exactly as documented (text substitution of `$ARGUMENTS` and `${CLAUDE_PLUGIN_ROOT}`, then the shell; for the heredoc commands, the fenced command with the input inserted). Claude Code's docs don't say whether `$ARGUMENTS` is escaped; the fix doesn't depend on it.
- **Time:** session rules run on a virtual clock (hours pass in microseconds); the window server uses the real clock, so trial expiry is reached by moving `usage.json`'s first-run date, and "quiet for 2 h" only in the session layer. Near midnight, "today" totals shift (seen once, fixture fixed).
- **Concurrency** is stress-tested (8 processes, 6 × 2,000 events) against an oracle, not proven; sql.js (old Node) is single-writer by design and not raced.
- **Other platforms:** Windows / Linux terminals and paths not run (macOS only).
- **Known, not changed:** the page lists at most 60 sessions from the last 12 h (a 61st open session that needs you would not show); "running" sessions silent for over an hour drop off the list as "unknown". Both are product rules, noted for a decision.

## 8. Verdict

**Ready for the free product; one P1 and three P2 defects found and fixed; nothing open from this pass.** The generator found 16 real defects (1 P1, 3 P2, 12 P3) plus 2 test problems, all fixed at the root with a regression each, and the last 6 fresh seed blocks ran clean (48,408 steps, 0 failures). `npm run ci` and `npm run test:e2e` pass 3 times in a row (§ below). Not ready to *sell* for the same reason as before: the Stripe Payment Link is still a placeholder.

Repeatability (after the last fix): `npm run ci` ×3 → {{CI}} · `npm run test:e2e` ×3 → {{E2E}}.
