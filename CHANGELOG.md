# Changelog

## 0.5.0
- **One white page instead of a sidebar:** your builds (what needs you first), how full each chat is, plan limits with reset times, tips for right now, and a prompt box. It opens beside your terminal. Use "Match my theme" for dark.
- **Limits:** 5-hour and weekly use with reset times. Pro adds when you'll run out at your pace (and how long until it's back) and which build is using your limit. API-key users see spend per build.
- **Tips with one-click fixes:** Start fresh chat, Turn on undo, pause the biggest build, plan first when stuck, New build when two builds share a folder.
- **+ New build:** another Claude in its own copy of the project, with readable names. It copies `.env` files and installs packages. Remove Finished Builds, plus `bp new`, `bp builds` and `bp done`.
- **Review & merge side builds:** see each changed file before ↔ after, then Merge (it saves first; on conflicts nothing changes and you get a fix prompt). Remove the folder after (the branch is kept).
- **Forecast grades itself:** after each 5-hour window, "past forecasts were off by about N min".
- `bp go [name]` jumps to the waiting build's tmux pane.
- **Prompts:** titled from your words, with "settle these first" questions. Start Claude with it, or use it in your open Claude. Prompts count only when used.
- **Free and Pro ($9/mo):** a 14-day Pro trial for everyone; nothing is blocked before Pro is on sale. Signed license keys, a Stripe → key license Worker (`server/`), `bp license`.
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
