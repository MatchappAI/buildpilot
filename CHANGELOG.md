# Changelog

## 0.12.3: finishing touches, tested end to end
- `bp go` could fail when picking between sessions in the same folder (it read the database after closing it).
- A session that ends right after a request counts as finished (headless runs can exit before their "finished" event lands).
- "Your turn" only while it's fresh (finished in the last 2 hours), everywhere; older idle sessions say "Idle". Housekeeping next steps stay hidden.
- Duplicate events are merged on either side of the time window; session start time no longer drifts when old events are cleaned up; a wrapped progress line never starts with a stray "·".
- Checked: Claude Code skips hook events it doesn't know with a one-line notice, so the newer events never break older setups.

## 0.12.2: clearer and more accessible (nothing removed)
- Text is at least 13px everywhere in the window (was 12px); menu-bar small text 11pt (was 10pt).
- Every session row says its status in words for screen readers, not only with the colored dot. The floating panel and its summary have VoiceOver labels.
- Click targets for text buttons ("Go to tab", "Looks fine", rename) are at least 24×24 px (WCAG 2.2).
- Narrow windows and 400% zoom: the chat % and usage text wrap instead of running off the edge (checked at 320 px and 640 px).
- macOS "Increase contrast" gives darker secondary text and borders.
- Plain words: no "hooks", "hook script", "status-line reporter" or "transcript" in what you see.
- Automated WCAG 2.1 AA audit now also covers progress, proof, risks, checklist, "Earlier today" and "your turn", in light, dark and expanded views.

## 0.12.1: second review round
**Security**
- Another local site (any dev server on 127.0.0.1) could drive the window, because browsers share cookies across local ports. Now every action needs the page's own key in a header (the cookie only opens the page and holds a session nonce, never the key), other origins are refused, and the page can't be framed. The launcher never falls back to a key in the URL.
**Status you can trust**
- Auto-compaction no longer flips a working session to "your turn" or moves its folder. After you approve a helper's request the session goes back to "working" (and stops re-notifying: approval alerts are keyed by what's being asked). A session with no start event still gets its folder.
- Checklist follows the task tools end to end (ids attached on TaskCreated; deleted tasks removed).
- "Tests passed" only for real test runs: not `cat jest.config.js`, not `npm test | tail` (the pipe's exit code isn't the tests').
- Risk warnings judge the program that runs: no more warnings for quoted text, branch names or `grep "DROP TABLE"`; every `rm -rf` target is checked; `$HOME` is caught; variables aren't guessed. "Looks fine" hides a session's warnings.
- Older Node (read-only) leaves events for a process that can record them. `bp doctor` without --fix only reads. VS Code toasts no longer swallow the Mac notification. Start fresh copies the summary of the session being restarted. Merge uses the side build's own branch. Today's cost never counts yesterday's spend; the baseline file is written atomically. Failing scripts (`node x.js`, `python x.py`) count as errors again.
**One answer everywhere**
- Needs you · your turn · working, in the same words in the window header, `bp glance`, `bp today` (new "Your turn" section) and the menu bar. Housekeeping tips never pose as the next step. "5-hour limit" / "Weekly limit" everywhere; calm bars until 80%; no forecast from under 10 minutes of data.
- Window: details always show what's known (this request, steps, proof), clearer chevron, fixed action column, "of your usage today", status line never repeats the task. Help regrouped (everyday · side builds · setup), aligned `bp sessions`. Widget "+N more" expands the floating panel.

## 0.12.0: your Claude Code companion
**Trust (the numbers are right)**
- Repeated events count: a second "yes", Stop or idle notice is no longer dropped as a duplicate. Only the same event delivered twice within a few seconds (plugin + settings hooks) is merged.
- The spool watcher no longer wakes itself ~20×/s (its own heartbeat file re-triggered it); bursts are read in one batch.
- Database safety: a busy/locked database is never treated as corrupt; older Node (sql.js) opens a shared WAL database read-only instead of replacing it under other processes.
- Past 2000 unread events the hook drops tool steps but always keeps status changes (prompt, approval, finished, failed, ended); hard stop at 5000.
- Subagent events and late background hook events can't flip a finished session back to "working". Hidden-as-idle sessions come back when Claude works there again. A session keeps the folder it started in.
- Errors = real failures (tests, builds, installs, pushes…), not every `grep` that exits 1. Claude's own test runs count for test status. "Today's usage" counts only today's spend per session. Hourly cleanup.
**Security**
- Window links use a one-time launch code + HttpOnly cookie: the token never appears in a URL, history or the process list. The server only acts on folders/files BuildPilot knows (sessions, side builds, files Claude edited). Wider secret redaction (URL credentials, `x-api-key`, `--password`, `mysql -p…`). One notification per moment across the window, VS Code and the menu bar.
**The four questions**
- Claude's checklist ("Step 3 of 7 · Adding login") from TodoWrite / task tools / TaskCreated·TaskCompleted hooks. Per request: steps, files changed, proof (tests passed after the last change / failing / not tested yet). Risk signals (force-push, reset --hard, rm -rf on a real folder, secrets files, tests edited while failing). "May be stuck" also for one step running 20+ min.
- `bp today` / `/bp-today`, `bp doctor [--fix]` / `/bp-doctor`.
**UI**
- One vocabulary (sessions, "chat X% full", side builds) and one threshold set (chat 70/90, limits 80/95) across window, terminal and menu bar. Go to tab on every row, Start fresh on the row from 70%, task line, chevrons, collapsed repeated steps, plain tool names, two columns on wide windows, j/k/g// keys. Glance and widget no longer point to VS Code.
- Menu-bar widget: gauge icon (not Safari's compass), rows jump to the session's tab, Open BuildPilot opens the window, optional **floating panel** (compact/expanded, never takes focus, keep-on-top optional).

## 0.11.0: works for more Claude Code users
- **No more crash on older Node:** the plugin now ships the database fallback (`sql-wasm.wasm`), so Node 18–22.4 works. If Node is missing, every slash command says so in one plain line instead of a stack trace (`plugin/bin/bp.sh`).
- **Spool can't grow forever:** the first event starts the 2-day safety clock (before, a plugin that was never opened kept writing), unread events are capped at 2000, and spool files are owner-only.
- **`/bp-terminal`:** adds the `bp` command to your terminal for plugin-only users.
- **Windows and Linux:** Resume / New build / Start fresh open Windows Terminal (or cmd) and the common Linux terminals (GNOME, Konsole, Xfce, kitty, Alacritty, xterm). On Windows, "Start Claude with this prompt" copies the prompt and opens Claude.
- **Dark page:** the standalone window follows your system's light/dark setting until you choose, with AA-contrast colors. The smallest text is now 12px.
- **Connected twice?** A tip appears when both the plugin and the older settings hooks are on (every step counted twice), with one click to remove the older hooks.
- Tests: 156 (plugin package, both spool scripts, dark contrast, minimum text size).

## 0.10.0: a clearer, calmer window
- **Plain words, not shell:** what each build is doing reads like "Running tests", "Installing packages", "Pushing to GitHub", or "Looking through files", never raw text like "Running -d)". The full command is still there on hover. Codex builds get the same treatment.
- **Readable history:** "Recent steps" is in plain past tense ("Ran tests", "Edited cart.ts", "Asked you before pushing to GitHub"). It shows the last 10 steps on one line each, with times that no longer wrap.
- **Expanded builds use the full width:** token details and steps span the row instead of being squeezed into a narrow column. Token sources read "File package-lock.json" and "Output of git status".
- **Less noise:**
  - "Who changed a file?" is now a single link until you need it.
  - "0% of today's use" is hidden.
  - The chat % column lines up from row to row.
- **Fixes:**
  - The start size shows "unknown" instead of "0".
  - Model names read "Opus 5.5".

## 0.9.0: polish from the all-round review
- **Keyboard focus survives live updates:** buttons keep focus when new state arrives, tested.
- **Accessible dialogs:** the project picker uses real buttons with arrow and Tab access, and every dialog announces its question. Footer actions are real buttons, and the rename pencil is visible.
- **Status you can trust:**
  - Shell control words are skipped ("until curl …" → "curl …").
  - "Quiet for 17 min, may be stuck" replaces the contradictory "may be stuck · Thinking", and it never shows during a long command.
  - Long commands stay on one line (full text on hover).
- **Near-limit has an action:** the heads-up offers "Pause <build using most> (64%)". There's no duplicate forecast line while it shows.
- **Consistency:**
  - One action slot per row, and Codex rows marked "read-only".
  - Side builds use the group style.
  - No trial chip while the trial banner is up.
  - Middle dots instead of em dashes.
  - Prompts no longer repeat the title or ask for a plan twice.
- **Website:** a top-aligned hero, a real-size product close-up, and an honest proof line (open source, tests, WCAG audited).

## 0.8.0: accessibility, a sharper brand, and a website
- **New mark:** a terminal prompt (>_) inside an instrument gauge, "a cockpit for Claude Code", echoing the chat ring. Legible down to 16 px. One script (`scripts/make-brand.mjs`) regenerates every size.
- **Accessibility:**
  - WCAG 2.1 AA automated audit (axe-core) in the test suite for every main state.
  - Text colors fixed to 4.5:1 or better.
  - Screen readers hear who needs you and when you're near your limit.
  - Proper headings in the build list, expand buttons wired to their panels, and accessible dialogs (focus trap, Escape, focus restored).
  - A visible focus ring, Windows high-contrast support, reduced motion, and layouts that reflow down to 380 px without sideways scrolling.
- **Design:**
  - Labelled numbers ("chat 46%" / "22% of today's use", now over the whole day).
  - The chat ring stays neutral until 70%, so green only means healthy.
  - Actions always visible, and one primary button per thing.
  - One card-header style, with Disconnect set apart.
  - A short trial note, and a "What you'll see" preview on first run.
- **Clearer status:** "Freeing port 8765" instead of raw shell, the full command on hover, branch names to tell builds apart, and "may be stuck" only when nothing is running.
- **Thank-you page:** a spinner, numbered next steps, and a fallback message if the key takes longer than 20 seconds.
- **Website:** https://matchappai.github.io/buildpilot/ (`docs/index.html`): hero, install, features, pricing, privacy.

## 0.7.0: new look, fewer false alarms
- **New brand:** a blue paper-plane-prompt mark and a BuildPilot wordmark, used across the app, Desktop app, extension, thank-you page, README and guide.
- **Heads-up strip:** one calm line at the top when something needs you (approval, 80% limit, stopped build, error burst), with the button to act.
- **Calmer rows:** a chat-fullness ring, one meta line, actions on hover, project headers only where they help, and hints that tell same-named builds apart.
- **Errors you can trust:** searches that find nothing and edits that miss their text count as normal retries, not red errors.
- **"Finished · your turn"** on the row, plus a notification when a long turn ends. **"May be stuck"** after 10 quiet minutes.
- **Clearer actions:** the main command in a chain ("npm run build", not "mkdir -p"), and the overlap tip names both builds. Undo warns when several builds changed the file.
- **Tokens:** a total-sent figure per build (what drives your limits).
- **Codex:** live action and recent steps from tool calls, with 3 days of logs.

## 0.6.0: built for heavy Claude Code users
- **What each build is doing now:** "Running npm test · 4 min", "Editing checkout.tsx", "Thinking" (from hook events). Click a build for its recent steps.
- **Errors you can see:** a red "3 errors" chip per build. It shows the real error lines and **Copy for Claude**. Error bursts trigger an alert.
- **Where the tokens went:** per build, the starting size before your first message (tools, MCP, CLAUDE.md), chat size, output, model, subagents and compactions. On Pro, the biggest things pulled into the chat (e.g. "Read package-lock.json ≈38k"). Tips: big file reads, heavy starting load (/mcp), subagent sprawl, compaction.
- **Many sessions:** no 12-build cap. Builds are grouped by project, you can name them, "Stopped mid-task" gets **Resume**, quiet builds fold away with **Clear them**, and background/temp-folder runs are hidden.
- **Who changed this file?** Find a file → which build changed it, when → **Undo this file** (safety save point first). Also `bp who <file>` and `/bp-who`.
- **Codex support (read-only):** Codex sessions from `~/.codex` appear with a Codex tag: working/idle, last message, tokens, limits when reported, errors like "usage limit".
- **Alerts in the standalone app:** Mac notifications for needs-you, 80% / 30-min limit, error bursts, compaction and stopped builds (once each; toggle in the footer).
- **Find it, no tmux needed:** brings the right Terminal or iTerm tab to the front (`bp go` too). Waiting rows show the exact command waiting for your OK.
- **Smarter limits:** the forecast weights recent minutes, so it reacts to big jobs starting or stopping. A weekly history line and a "your week runs out <day>" warning. An "auto-approve on" chip when only some builds skip permissions.

## 0.5.0
- **Its own window, no VS Code needed:** `bp ui`, `/bp-ui`, or the Desktop app opens BuildPilot privately on this computer (token-protected local server). Start Claude, fresh chats and new builds in Terminal. **Resume** an idle build (`claude --resume`). **Find it** for a waiting one. Switch project from the header.
- **One white page instead of a sidebar:** your builds (what needs you first), how full each chat is, plan limits with reset times, tips for right now, and a prompt box. It opens beside your terminal. Use "Match my theme" for dark.
- **Limits:** 5-hour and weekly use with reset times. Pro adds when you'll run out at your pace (and how long until it's back) and which build is using your limit. API-key users see spend per build.
- **Tips with one-click fixes:** Start fresh chat, Turn on undo, pause the biggest build, plan first when stuck, New build when two builds share a folder.
- **+ New build:** another Claude in its own copy of the project, with readable names. It copies `.env` files and installs packages. Remove Finished Builds, plus `bp new`, `bp builds` and `bp done`.
- **Review & merge side builds:** see each changed file before ↔ after, then Merge (it saves first; on conflicts nothing changes and you get a fix prompt). Remove the folder after (the branch is kept).
- **Forecast grades itself:** after each 5-hour window, "past forecasts were off by about N min".
- `bp go [name]` jumps to the waiting build's tmux pane.
- **Prompts:** titled from your words, with "settle these first" questions. Start Claude with it, or use it in your open Claude. Prompts count only when used.
- **Free and Pro ($5/mo):** the forecast and 80%/30-minute limit alerts are free. Pro is the parallel-build workflow (unlimited side builds, tests before every merge), per-build usage and unlimited prompts. A 14-day trial for everyone; nothing is blocked before Pro is on sale. `bp review`, `bp merge`, `/bp-merge`. Signed license keys, a Stripe → key license Worker (`server/`), `bp license`.
- **Claude Code plugin:** `/plugin install buildpilot@buildpilot` adds `/bp`, `/bp-prompt`, `/bp-new`, `/bp-connect` and `/bp-license`. Also `bp limits` and `bp tmux`.
- **Trust:** "See exactly what changes" before Connect, Disconnect on the page, a hook safety stop, optional anonymous counts (off by default, their own random id).

## 0.4.0
- **Menu-bar widget (macOS):** BuildPilot Bar shows Claude Code sessions, what needs you and your plan limits in the menu bar, even with VS Code closed. It notifies you when a session is waiting, and clicking a session opens it in BuildPilot. Install it from Connect → Menu bar. It starts at login (optional), and you can remove it anytime.
- `bp widget` (JSON) and `bp bar status|install|uninstall`.
- Marketplace listing: "BuildPilot for Claude Code".

## 0.3.2
- Full review pass. Disconnect now waits for your confirmation, Escape cancels name prompts, live refreshes keep your typing, focus and ticked files, actions show visible confirmations, metrics and badges are consistent, and CLI usage and output are clearer.

## 0.3.1
- BuildPilot in every terminal (`bp`, start-up summary). The panel opens beside new terminals. Metric tiles. Accessibility pass. Multi-window-safe storage.

## 0.2.x
- Sessions from all projects, Getting Started walkthrough, START HERE guide, Desktop install and uninstall scripts.

## 0.1.0
- First release: live sessions via Claude Code hooks, supervisor, Prompt Studio, memory, checkpoints, Integration API and Pocket.
