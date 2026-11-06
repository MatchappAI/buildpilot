# BuildPilot for Claude Code

**One calm page beside your terminal: every Claude build, what needs you, how full each chat is, your plan limits (and when you'll run out), and tips for right now.**

Made for people who build with Claude Code and don't want to babysit it, including people who aren't engineers.

- **Builds:** every Claude Code chat across your projects, needs-you first, with **Review in terminal**. Nothing is approved until you approve it there.
- **Plan limits:** 5-hour and weekly usage, when each resets, and on Pro, *"At this pace you'll run out around 5:47 PM, then wait 1 h 37 min."* API-key users see spend instead.
- **Tips for right now:** only when they apply, each with one button. Chat nearly full → **Start fresh chat**. A build stuck repeating a fix → plan first. Two builds in one folder → **New build**. No Git → **Turn on undo**.
- **+ New build → Review → Merge:** another Claude in its own copy of the project (it copies your `.env` files and installs packages), so builds can't undo each other's work. When it's done, **Review** shows each changed file before ↔ after and **Merge** brings it in. On a conflict nothing changes, and you get a ready fix prompt.
- **Prompt box:** plain words in, an expert prompt out, with your project's setup, guardrails, checks and "settle these first" questions.

Everything stays on your computer. [How it compares](docs/COMPARISON.md) · [Privacy](docs/SECURITY.md)

## Install

**VS Code, Cursor or Windsurf:** search the Extensions view for **BuildPilot for Claude Code** (VS Code Marketplace or Open VSX). Open a terminal and the page opens beside it. Click **Connect**.

**Inside Claude Code (any editor, or none):**

```
/plugin marketplace add MatchappAI/buildpilot
/plugin install buildpilot@buildpilot
```

Then use `/bp` (builds, limits, tips), `/bp-connect` (exact chat % and limits), `/bp-new <name>`, `/bp-prompt <idea>` and `/bp-license <key>`.

**Terminal:** `bp limits` · `bp new "<name>"` · `bp go` (jump to the build that needs you) · `bp builds` / `bp done <name>` · `bp tmux` (status segment) · `bp prompt auto "<idea>"` · `bp help`

From source: `npm install && npm run package && code --install-extension dist/buildpilot.vsix`

## Free and Pro

| Free forever | Pro, $9/mo, cancel anytime |
|---|---|
| Builds and what needs you · chat % full · plan limits and reset times · tips with one-click fixes · Start fresh chat · Turn on undo · terminal, plugin and menu bar · 20 prompts · 2 builds at once | When you'll run out, and which build is using your limit · as many builds at once as you like · unlimited prompts |

Everyone gets a **14-day Pro trial**. Nothing is ever blocked before Pro is on sale. Pro is separate from your Claude plan. After checkout, the thank-you page shows your key. Paste it with **BuildPilot: Enter License Key** or `bp license <key>`.

## Privacy, in one paragraph

**Connect** adds hooks and a status-line reporter to `~/.claude/settings.json`. You see the exact lines first ("See exactly what changes"), your settings are backed up, and **Disconnect** removes exactly those lines. Hooks copy each Claude Code event to `~/.buildpilot/spool`. BuildPilot then:
- reads the events
- redacts secrets
- stores a short log: tool names, commands, file names and errors, but no file contents
- deletes the copies
- keeps the log at most 30 days

Nothing is uploaded. There's no telemetry unless you say yes to a one-time question (4 anonymous counts, with a random ID used only for that).

## Develop

`npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:smoke` · `npm run ci` · `npm run package` · `npm run desktop`

- `src/core`: the engine, with no vscode imports. That includes `page.ts`, `tips.ts`, `license.ts` and `counts.ts`.
- `src/extension`: the VS Code glue and the page panel.
- `src/webview`: the page itself.
- `src/cli.ts`: the `bp` command.
- `plugin/`: the Claude Code plugin. The marketplace file is `.claude-plugin/marketplace.json`.
- `server/`: the license Worker (Stripe → signed key).

More: [docs/](docs/), with [PUBLISHING.md](docs/PUBLISHING.md) for the steps that need your accounts.
