# Live QA report (2026-11-16, v0.12.5, branch `live-qa/2026-11-16`)

This pass operated the real window like a person: the real `bp ui` server on a **seeded throwaway HOME** (never the installed copy), headless Chrome (`--headless=new`, nothing on screen), real mouse presses at element centres, real key events, hover, two tabs at once, 1.2–1.5 s network latency, rapid and double clicks, abandon-halfway, reload, server stopped mid-use, desktop 1280 px and phone 375 px, light and dark. Screenshots were opened and looked at. The menu-bar widget was rendered offscreen (no window, no menu-bar item). It builds on the code audit (docs/APP_AUDIT.md, QA_MATRIX.md, ISSUE_TRACKER.md) and does not redo it.

**Seeded day** (`test/e2e/seed.mjs`, written as the hook events and status-line files Claude Code itself produces, with real timestamps): two git projects (`proj`, `blog`); 7 sessions: needs your OK (Bash `rm -rf`), working with Claude's own 5-item checklist, finished with tests passed and chat 78 % full, stopped mid-task 50 min ago, 4 errors this hour, quiet 3 h, closed earlier today; plan limits 84 % / 41 %; side builds made in the UI; free plan (20 prompts, 2 builds), Pro trial, trial ending, and a real Pro key (minted locally for 1 day, kept only in the throwaway home).

Evidence: screenshots in `qa/screenshots/` (before/after pairs), automated journeys in `test/e2e/ui-live.mjs` (+ one step in `ui-free.mjs`), regressions in `test/unit/liveqa.test.ts`.

## Coverage

| | Count |
|---|---|
| Inventory rows (tracker below) | 54 |
| Tested in the live UI | 48 |
| Passed (after fixes) | 48 |
| Failed at first, fixed and re-verified live | 23 (3 P1, 9 P2, 11 P3) |
| Still failing | 0 |
| Blocked (would show on screen / touch real accounts) | 4 |
| Not tested | 2 |

## Workflow graph (how people move through the window)

```
first run ──Connect (confirm)──▶ sessions page ◀──────── Disconnect (confirm) ───┐
   │  └─ See exactly what changes (dialog)                                         │
   ▼                                                                               │
sessions page ─┬─ heads-up: Go to tab · Resume · See them (errors) · Pause (only a working session)
               ├─ row: expand ▸ details (steps, checklist, tokens) · ✎ name · Looks fine · errors chip → Copy for Claude
               │        · Go to tab / Resume / Start fresh (confirm → summary copied + terminal)
               ├─ Show/Hide quiet · Clear them (confirm)
               ├─ Who changed a file? → Find → Undo this file (confirm → safety save point)
               ├─ + New side build → [Go Pro first if at the free limit] → name → confirm → terminal
               │        └─ side list: Review (dialog) → Merge (confirm → tests → [FAIL: Merge anyway?] → merged | conflict dialog + fix prompt) → Remove (confirm)
               ├─ Project ▾ → picker (known projects + folders Claude worked in) → page switches (persists)
               ├─ Tips: Resume · See them · Give one its own copy · Turn on undo (never for ~) · Start fresh
               ├─ Next prompt: type → Write my prompt (Writing…) → edit → Start Claude (confirm) · Use in my open Claude · Copy
               │        └─ free plan: counter → paywall card at 21st → Get Pro (checkout) · I have a license key → Pro (paywall closes)
               └─ footer: Advanced tools · Auto light/dark ↔ White page · Alerts on/off
keyboard: j / k move between sessions · g goes to its tab · / jumps to the prompt · Esc closes the top dialog · Enter confirms
any time: server stops → red line "BuildPilot stopped running…" + "Nothing was changed" on presses
```

## Tracker

Status: **Pass** · **Fixed** (failed live, fixed, same sequence re-run and passing) · **Blocked** · **Untested**.

| Feature | Workflow | Expected | Actual (before → after) | Status | Sev | Root cause | Fix | Retest | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Messaging | Any call carrying a session id (rename, Go to tab, Resume, Looks fine) | Its answer arrives | Never arrived (promise leaked); with the new one-press guard the button went dead after one use | Fixed | P1 | `postMessage({type, id, ...data})`: the session `id` overwrote the reply id. Same in the VS Code sidebar | Reply matched by `rid`; page, server page script, sidebar, test mocks | rename twice ✓ | liveqa.test `a call that carries a session id…`; ui-live `rename … twice` |
| Name box | ✎ → type → Enter | Box closes, name saved | Name saved, **box reopened** (focus went back to ✎ and Enter clicked it again). Same for license key and side-build name boxes | Fixed | P1 | Enter not consumed in the input | `preventDefault` on Enter | ✓ | before-rename-enter-reopens.jpg; ui-live |
| Server stopped | bp ui closed while the page is open, then press anything | Clear message | Nothing happened, stale data shown as live, uncaught promise errors | Fixed | P1 | `post()` had no error path | Red line at the top + "Couldn't reach BuildPilot. Nothing was changed."; 401 → "page has expired" | ✓ | before-offline-silent.jpg → after-offline-banner.jpg; ui-live |
| Who changed a file? | Type while Claude is working | Text stays | Wiped every ~3 s (each live refresh) | Fixed | P2 | Box redrawn from the last *searched* text | Draft kept across redraws | ✓ | liveqa.test; ui-live |
| Prompt editor | Select / scroll inside the written prompt while sessions update | Selection + scroll kept | Selection collapsed, scrolled to top | Fixed | P2 | Redraw kept only the caret | Selection range, direction and every text box's scroll restored | ✓ | liveqa.test; ui-live |
| Any button | Double click / impatient second press; 1.2 s latency | One action, visible progress | Duplicate requests; no feedback while waiting | Fixed | P2 | No in-flight state | One press at a time per control, `aria-busy`, "Writing…" | 1 request ✓ | liveqa.test; ui-live (throttled) |
| Dialogs | Double click on a button that opens a dialog | Dialog stays | Second click hit the dimmed area and closed it instantly (looked dead); focus left the OK button so Enter did nothing | Fixed | P2 | Backdrop click-to-close + focus loss | Backdrop ignores clicks in the first 0.5 s and never takes focus | 1 dialog, 1 terminal ✓ | ui-live |
| Heads-up | 5-hour limit ≥ 80 % | Pause the busy session | "Pause proj (46 %)" pointed at a **finished** session; "proj" ambiguous among 3 | Fixed | P2 | Hog picked by share regardless of status | Only `running` sessions; names include the request words | ✓ | before-desktop.jpg → after-desktop.jpg; liveqa.test |
| Session row | Finished session with chat ≥ 70 % | Start fresh + Go to tab readable | "chat 78% fullStart fresh" overlapped | Fixed | P2 | Two links in a 92 px column | Actions stack in their column | geometry check ✓ | before-desktop.jpg → after-desktop.jpg; ui-live |
| Project picker | Open picker with sessions in `blog` | blog choosable | Only analysed projects listed | Fixed | P2 | List came from `projects` table only | Adds folders Claude worked in (not temp, not inside a listed project) | ✓ + survives reload | liveqa.test; ui-live |
| Menu-bar panel | Rename a session in the window; 3 sessions in one folder; stopped session | Same names everywhere; status agrees | Panel showed folder only (ignored names), 3× "proj", stopped = grey "Quiet" | Fixed | P2 | `SessionRow` used `folder`, word not stop-aware | Same `label` as the window (+ hint), "Stopped" + red dot | rendered ✓ | before-widget.jpg → after-widget-*.jpg |
| Turn on undo | Project = home folder (Claude often runs in ~) | Never `git add -A` your whole home | Tip offered; confirming would put every file in ~ into Git | Fixed | P2 (data/privacy) | No guard (found on the real-data look) | `tooBroadForUndo()`: refused for /, ~ and above (window, VS Code), tip hidden | ✓ | liveqa.test |
| Toasts | Two actions 1.8 s apart | Second toast shows full time | Second toast cut short | Fixed | P3 | Two unshared timers | One shared timer | ✓ | probe log |
| Prompt | Reload after writing a prompt | Prompt + its request kept | Prompt lost; summary could name a newer, different request | Fixed | P3 | Not persisted | Saved in view state with the request it was written for | ✓ | liveqa.test; ui-live |
| Side builds | Remove | Gone from the list | Listed for ~5 s after "Removed" | Fixed | P3 | List refreshed in the background | Awaited refresh after new/merge/remove | ✓ | ui-live |
| Pricing | Free plan at 2 builds → + New side build | Hear about the limit first | Asked a name and a confirm, then "Go Pro?" | Fixed | P3 | Gate only on create | `newBuildCheck` before the dialogs; Get Pro goes through the logged opener | ✓ | ui-free `free plan at its side-build limit` |
| Pricing | Enter a valid Pro key from the paywall | Paywall closes | "Pro" pill shown but paywall card stayed | Fixed | P3 | `paywalled` flag never cleared | Cleared when the plan says Pro | ✓ (temp key) | before-pro-paywall-stays.jpg |
| Session row | Long progress line wraps | No line starts with "·" | "· ✓ tests passed…" | Fixed | P3 | Separator travelled with its part | Test result on its own line | ✓ | liveqa.test |
| Session names | 3 sessions in one folder | Readable words | "the login button does", "add checkout page with" | Fixed | P3 | Word cut without trimming filler; with no folder read the current dir's branch | Trim filler at both ends; never read cwd | ✓ | liveqa.test |
| Tips | 4 errors this hour | One-click action like the others | No button | Fixed | P3 | `action: null` | "See them" opens the errors panel | ✓ | probe log |
| Tips | Project without Git + 3 session tips | No-undo tip visible | Pushed out by session tips (max 3) | Fixed | P3 | Ranked last | Ranked after limit/risk | ✓ | liveqa.test; probe log |
| Dialogs | Escape with a dialog open | Closes the top dialog only | Every open dialog's listener fired; listeners leaked | Fixed | P3 | Listener removed only on Escape | Removed with its dialog; only the top one reacts | ✓ | ui-e2e Escape step |
| Focus restore | Redraw with a focused row button | Focus kept | Threw where `CSS.escape` is missing | Fixed | P3 | `CSS.escape` dependency | Own attribute quoting | ✓ | liveqa.test |
| First run | Connect card, See exactly what changes, Connect by keyboard (Enter, Enter) | Clear, settings written once | as expected | Pass | | | | | first-run.jpg, first-run-375.jpg |
| Sessions | Seeded day renders: needs-you first, checklist step 3 of 5, tests passed, stopped, 4 errors, quiet, earlier today | as expected | as expected | Pass | | | | | after-desktop.jpg, after-375.jpg |
| Sessions | Expand details; errors chip → Copy for Claude; Looks fine | as expected | as expected | Pass | | | | | errors-panel.jpg, details-375.jpg |
| Sessions | Show quiet → Clear them (confirm) | hidden, history kept | as expected | Pass | | | | | probe log |
| Sessions | Resume (stopped), Start fresh (confirm → summary copied + terminal) | terminal logged, not opened | `claude --resume <id>` in blog; handoff copied | Pass | | | | | probe log |
| Sessions | Go to tab (button, heads-up, `g` key) | "Looking…", then where it runs | as expected | Pass | | | | | probe log |
| Who changed | Find → Undo this file (confirm) → file restored + safety save point; empty search; no match | as expected | as expected | Pass | | | | | probe log |
| Side builds | Abandon at name box (Esc) and at confirm (Esc) | nothing created | 1 worktree, 0 terminals | Pass | | | | | ui-live |
| Side builds | Create → change → Review → Merge (tests pass) → Remove | merged, folder gone, branch kept | as expected | Pass | | | | | ui-live |
| Side builds | Merge with failing tests → "Merge anyway?" → Cancel (main untouched) → Merge anyway | as expected | as expected | Pass | | | | | probe log |
| Side builds | Merge conflict | nothing changes, files listed, fix prompt copied | as expected, `git status` clean | Pass | | | | | probe log |
| Prompt | Type → Write my prompt (button and Cmd+Enter) → edit → Start (Cancel, then confirm) → Copy → Use in my open Claude | as expected | as expected | Pass | | | | | ui-e2e, probe log |
| Pricing | Free: counter, paywall at 21st, Get Pro (checkout URL logged), invalid key, cancelled Start not counted | as expected | as expected | Pass | | | | | free-paywall.jpg; ui-free |
| Pricing | Trial ending (2 days left) notice | as expected | "Pro trial ends Wednesday, Nov 18. No card on file." | Pass | | | | | probe log |
| Limits | Plan bars, reset times, heads-up at 84 %; API key billing shows "Spend today" | as expected | as expected | Pass | | | | | probe log |
| Turn on undo | Project folder without Git → tip → confirm | git + first save point | as expected | Pass | | | | | probe log |
| Prefs | Theme Auto light/dark with system dark → dark page → back to white; Alerts toggled 5× fast ends matching ui.json | as expected | as expected | Pass | | | | | sessions-dark.jpg; ui-live |
| Two tabs | Rename in tab 2 → tab 1 within 1 s; Disconnect in tab 2 → tab 1 shows Connect; reconnect from tab 1 | as expected | as expected | Pass | | | | | ui-live |
| Navigation | Reload (request, prompt, project choice kept); launch code single use | as expected | as expected | Pass | | | | | ui-live, ui-e2e |
| Keyboard | j/k/g, "/", Tab order (header → heads-up → sessions → side → tips → prompt → footer), Escape, Enter on dialogs | as expected | as expected | Pass | | | | | probe log |
| A11y | axe WCAG 2.2 AA on first run and on the seeded day; every control named; toasts announced | 0 violations | 0 | Pass | | | | | ui-e2e, ui-live |
| Responsive | 375 px first run, sessions, details | no sideways scroll | none | Pass | | | | | after-375.jpg, details-375.jpg |
| Security | Rename with `<b>` and 60+ chars | shown as text, clipped to 40 | as expected | Pass | | | | | probe log |
| Widget | Panel light/dark, floating panel, seeded data, rendered offscreen (`scripts/render-widget.sh`) | readable, consistent with window | after fixes, yes | Pass | | | | | after-widget-light/dark/float.jpg |
| Real data | Copy of `~/.buildpilot` served by the new build, looked at only (no clicks), installed CLI `glance` | renders, no errors, no OS actions | as expected; found the home-folder undo risk | Pass | | | | | probe log |
| Widget | The installed menu-bar app itself (click, notifications) | — | — | Blocked | | would show on screen / post notifications | | | — |
| VS Code | Extension host | — | — | Blocked | | opens a visible VS Code | jsdom runs the same bundle | | — |
| Plugin | Slash commands inside real Claude Code | — | — | Blocked | | would write into real data | | | — |
| Pricing | Live Stripe purchase | — | — | Blocked | | placeholder Payment Link | | | — |
| Codex | Codex sessions in the list | — | — | Untested | | needs Codex logs | | | — |
| Tips | "Remove older hooks" (plugin + settings hooks both on) | — | — | Untested | | needs the plugin installed in the throwaway home | | | — |

## UI/UX changes (before → after)

- The needs-you line, Pause button, tips and menu-bar panel name the exact session: "proj (clean the old build)" instead of three identical "proj".
- Session rows: no overlapping links; the test result gets its own line; names read as words ("login button does nothing").
- Every action gives feedback: "Writing…" while a prompt is written, a red line if BuildPilot stops, "Nothing was changed" if a press couldn't be sent.
- Fewer surprises: Enter in a name box just saves; a double click never closes the dialog it opened; the free plan says "Go Pro?" before asking for a name; the paywall closes once Pro is on.
- Nothing typed is lost: the file box, a selection in the prompt, and the written prompt across a reload.
- Safer: "Turn on undo" is never offered for the home folder.

## Remaining risks

- The installed menu-bar app (`~/Applications/BuildPilot Bar.app`) still has the old panel labels until the widget is rebuilt and reinstalled (`npm run build:widget` + `bp bar install`); not done here to avoid relaunching it in front of the owner.
- Header says "Project: demo" (package.json name) while rows say "proj" (folder name) when they differ. Left as is (needs a product call).
- Long names push the ✎ onto its own line (cosmetic).
- Bad JSON to `/api/msg` answers 500, not 400 (cosmetic, from the audit).
- Blocked areas above.
