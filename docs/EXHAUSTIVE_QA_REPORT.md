# Exhaustive QA report: every path, every action, every sequence (2026-11-17, v0.12.6)

Branch `exhaustive/2026-11-17` (not pushed). Builds on the code audit (APP_AUDIT, QA_MATRIX, ISSUE_TRACKER, FINAL_READINESS_REPORT) and the live UI pass (LIVE_QA_REPORT) and does not redo them. This pass goes for completeness, systematically: the app is modelled as state machines, a seeded generator drives the **real** code with long random sequences, checks invariants after every step, shrinks any failure to a minimal sequence and saves it as a regression.

"Every sequence" is infinite, so this report states the coverage criteria actually met, with the numbers the generator printed (`qa/model-coverage.json`, written by the run itself).

**Re-run:** `npm run test:model -- --seed N` (all layers, ~1.5 h) · `npm run test:model -- --quick --seed N` (~8 min) · `--layers session,api,ui,…` · `--seeds K` · `--steps M` · `--regressions` (saved shrunk sequences only) · `--write-model` (writes `qa/model.json`). Nothing appears on screen: headless Chrome (`--headless=new`), throwaway HOMEs under `~/Library/Caches/bp-model-*`, every OS effect (Terminal, clipboard, notifications, opening links, bringing a tab forward) written to a log instead of happening. License tests use a throwaway Ed25519 key generated per run and swapped into a test bundle (`test/model/build.mjs`); the real issuer key is never used.

## 1. The model (qa/model.json)

{{MODEL}}

Each machine's states, actions, which (state, action) pairs are possible, and why the rest are not, are in `qa/model.json` (generated from `test/model/model.mjs`). Expected effects live with the executors:

- **Session lifecycle** (hook ingest): `test/model/session.mjs` `spec()`, an oracle written from the documented rules (status per event, subagent and late-event rules, out-of-order delivery, duplicates within 5 s, genuine repeats, malformed payloads, quiet sessions hidden and coming back). Driven in-process through the real spool reader, ingestor and node:sqlite store, with a virtual clock.
- **Side builds** (none → clean → unsaved → saved → merged → removed, with conflict and failing-tests variants and reversals): `test/model/api.mjs` (`BUILD_EDGES`, `mergeAction`, `removeAction`), against the real `bp ui --serve` and real git worktrees, through the window API and the CLI (`bp new / review / merge / done / builds`).
- **Plan / license** (free, free-exhausted, trial, trial-ending, licensed, not-sellable; keys valid, expired, forged, garbage), **connection** (disconnected, connected, plugin, plugin + hooks), **prefs** (theme × alerts), **project** (clean / unsaved changes), **session actions from the window** (rename, Looks fine, Resume, Go to tab, Start fresh, Who changed, Undo file).
- **Window screens** (connect card, sessions, prompt written, file finder, paywall, 4 dialog kinds, offline, expired, server down): every visible `data-act` control, every dialog answer (OK, Cancel, Esc, Enter, backdrop, typing, picking), keys (j, k, g, /, Tab, Esc, Cmd+Enter) and environment actions: reload, reopen, second tab, slow network, offline, server stop / start / restart, phone width, dark mode, plus changes made behind the window's back (hook events, CLI side builds, API calls, edits in a build).

## 2. Coverage, per criterion

{{COVERAGE}}

## 3. Seeds and steps run

{{RUNS}}

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

{{BUGS}}

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

{{LIMITS}}

## 8. Verdict

{{VERDICT}}
