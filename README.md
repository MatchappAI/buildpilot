# BuildPilot for Claude Code

**A helper for Claude Code, in its own calm window: every Claude build, what needs you, how full each chat is, your plan limits (and when you'll run out), and tips for right now.**

Made for people who build with Claude Code and don't want to babysit it, including people who aren't engineers.

- **Builds:** every Claude Code (and Codex) session across your projects, grouped by project, needs-you first. Each shows **what it's doing right now** ("Running npm test · 4 min"), errors, and the exact command waiting for your OK. **Find it** jumps to the right Terminal/iTerm tab. Name builds, resume ones that stopped mid-task, and clear out quiet ones.
- **Where the tokens went:** per build, the starting load before you type (tools, MCP, CLAUDE.md), chat size, model, subagents, and the biggest things pulled into the chat, with tips to cut them.
- **Who changed this file?** It tells you which build changed it and when, with one-click undo.
- **Plan limits:** 5-hour and weekly usage, when each resets, and *"At this pace you'll run out around 5:47 PM, then wait 1 h 37 min."* It warns you at 80%. API-key users see spend instead.
- **Tips for right now:** only when they apply, each with one button. Chat nearly full → **Start fresh chat**. A build stuck repeating a fix → plan first. Two builds in one folder → **New build**. No Git → **Turn on undo**.
- **+ New build → Review → Merge:** another Claude in its own copy of the project (it copies your `.env` files and installs packages), so builds can't undo each other's work. When it's done, **Review** shows each changed file before ↔ after and **Merge** brings it in. On a conflict nothing changes, and you get a ready fix prompt.
- **Prompt box:** plain words in, an expert prompt out, with your project's setup, guardrails, checks and "settle these first" questions.

Everything stays on your computer. [How it compares](docs/COMPARISON.md) · [Privacy](docs/SECURITY.md)

## Install

BuildPilot is a helper for **Claude Code**. You don't need VS Code or any other editor.

**1. Inside Claude Code** (one time):

```
/plugin marketplace add MatchappAI/buildpilot
/plugin install buildpilot@buildpilot
```

**2. Open it:**
- `/bp-ui` in Claude Code, or `bp ui` in a terminal, opens BuildPilot in its own window.
- On a Mac, the **BuildPilot** app on your Desktop does the same: double-click.
- In Claude Code, `/bp` shows your builds, limits and tips. Also `/bp-new <name>`, `/bp-merge <name>`, `/bp-prompt <idea>`, `/bp-connect` (exact chat % and limits) and `/bp-license <key>`.

**Terminal:** `bp ui` · `bp limits` · `bp new "<name>"` · `bp review` / `bp merge <name>` · `bp go` (jump to the build that needs you) · `bp who <file>` · `bp builds` / `bp done <name>` · `bp tmux` (status segment) · `bp prompt auto "<idea>"` · `bp help`

*Optional:* if you also work in VS Code or Cursor, the same page can sit beside your terminal there (`dist/buildpilot.vsix`).

## Free and Pro

| Free forever | Pro, $5/mo, cancel anytime |
|---|---|
| Builds and what needs you · chat % full · plan limits, reset times **and when you'll run out** · limit alerts · tips with one-click fixes · Start fresh chat · Turn on undo · terminal, plugin and menu bar · 20 prompts · 2 builds at once, with Review & Merge | As many builds at once as you like, each reviewed and merged from the page · your tests run automatically before every merge · which build is using your limit · unlimited prompts |

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
