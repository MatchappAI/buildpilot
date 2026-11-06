# BuildPilot for Claude Code

**One calm page beside your terminal: every Claude build, what needs you, how full each chat is, your plan limits (and when you'll run out), and tips for right now.** Made for people who build with Claude Code, including people who aren't engineers.

## What you get

- **Builds.** Every Claude Code chat across your projects, the one that needs you first, with **Review in terminal**. It never approves anything for you.
- **Plan limits.** 5-hour and weekly usage and when each resets. Plus *"At this pace you'll run out around 5:47 PM, then wait 1 h 37 min"*, and an alert at 80%. API-key users see spend per build.
- **Tips for right now.** Only when they apply, each with one button: Start fresh chat, Turn on undo, pause the biggest build, plan first when a build is stuck.
- **+ New build.** Another Claude in its own copy of the project, so builds can't undo each other's work. It copies `.env` files and installs packages.
- **Prompt box.** Plain words in, an expert prompt out, with your project's setup, guardrails, checks and "settle these first" questions.
- **Everywhere:** Claude Code plugin (`/bp`), terminal (`bp limits`, `bp new`, `bp tmux`), and a Mac menu-bar widget.

**Free forever:** builds, chat %, limits, the run-out forecast and 80% alerts, tips, 20 prompts, and 2 builds at once with Review & Merge. **Pro, $5/mo:** unlimited parallel builds, tests before every merge, per-build usage, unlimited prompts. Everyone gets a 14-day Pro trial, no card needed.

## Honest by design

Every fact is labelled **Verified**, **Inferred**, **Unverified**, **Failed** or **Unknown**. BuildPilot never invents progress, prices or context numbers. If it doesn't know, it says "Unknown".

## Private by default

- Everything runs and is stored on your computer (`~/.buildpilot`). No account, and no cloud.
- It uses only Claude Code's documented hooks and status line. Your settings are backed up first, and **Disconnect** restores them.
- Nothing runs without your confirmation: scripts, terminals, file writes and network calls all ask first.
- Optional AI explanations use your own Anthropic API key or a local Ollama model, and ask each time.

## Get started (2 minutes)

1. Open a project folder and click the **BuildPilot** compass icon in the Activity Bar.
2. Click **Connect**. BuildPilot shows exactly what it adds to Claude Code's settings before changing anything.
3. Run `claude` in a terminal as usual. The session appears within a second.
4. Optional: **Connect → Add to menu bar**, and **Show in every terminal**.

Want to look around first? **Connect → Load demo data**. Demo sessions are clearly labelled.

## Requirements

- VS Code 1.90 or newer (also works in Cursor and Windsurf via Open VSX).
- [Claude Code](https://claude.com/claude-code) for live sessions. Project analysis works without it.
- The menu-bar widget needs macOS 13 or newer. The terminal summary works with zsh and bash.

## Commands

Open the Command Palette and type **BuildPilot** to see them all, including: Open Mission Control, Connect to Claude Code, New Prompt (`⌘⌥P`), Save Checkpoint, Run Tests, Check Dependencies, Visual Check, Add Menu-Bar Widget, Show in Every Terminal, and Getting Started.

BuildPilot is an independent tool and is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.
