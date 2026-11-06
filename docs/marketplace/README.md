# BuildPilot for Claude Code

**Mission control for building software with Claude Code.** See every Claude Code session at a glance, know the moment one needs you, watch context and plan limits, and always know the next best step.

BuildPilot sits beside Claude Code and works like a calm senior engineer looking over your shoulder. It never edits your code on its own.

## What you get

- **Live sessions.** Every Claude Code session in every project, with its status (working, needs approval, needs input, failed), its current task, changed files, errors, and the **exact context %** reported by Claude Code. A session waiting for your approval is surfaced immediately.
- **One next step.** A prioritized recommendation with the evidence behind it, such as "Tests are failing", "Two sessions are editing the same file" or "Secrets in Git", plus a ready-to-run fix prompt.
- **Supervisor.** Loop detection (the same error over and over), conflicting sessions, "done" claimed without passing tests, leaked secrets, missing environment variables, dependency vulnerabilities, a visual check of your running app, and a ship-readiness checklist.
- **Prompt Studio.** Pick a goal (feature, bug, integration, tests, refactor, UI, security, deploy, performance, handoff), describe it in plain words, and get a best-practice Claude Code prompt that includes your project's context, guardrails, acceptance criteria and verification commands. Copy it, or start Claude Code with it in one click.
- **Project memory.** Goals, requirements with "done when…" criteria, decisions and a one-click session handoff, so a fresh session never loses the plot.
- **Safe changes.** Checkpoints that never touch your branch or staging area, and per-file restore with an automatic safety checkpoint first.
- **Everywhere you are:**
  - **Menu-bar widget (macOS).** Sessions, needs-you and plan limits in your menu bar, even with VS Code closed, plus a notification when a session is waiting.
  - **Terminal.** A short summary in every new terminal, and the `bp` command.
  - **Phone, smart glasses, Slack, Discord, ntfy.** Short alerts, and a phone page that can read status aloud.

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
