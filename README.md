# BuildPilot: Mission Control for AI builders

**Know what's being built, what's broken, what matters next, and how to ship it correctly.**

BuildPilot is a VS Code extension that sits next to Claude Code and acts like a calm senior engineer looking over your shoulder. It watches your Claude Code sessions through Claude Code's official hooks, analyzes your project locally, and tells you in plain English:

1. **What's happening**: each Claude Code session's live status, task, changed files, errors and token usage
2. **Is anything wrong**: failing tests, loops, two agents editing the same file, leaked secrets, missing config, "done" without proof
3. **What to do next**: one prioritized next step, plus a ready-to-use Claude Code prompt to do it

Everything runs on your computer. No account, no cloud, no AI calls unless you turn them on.

## Install (local)

```bash
cd ~/buildpilot
npm install
npm run package                       # builds dist/buildpilot.vsix
code --install-extension dist/buildpilot.vsix
```

If `code` isn't on your PATH, use VS Code → Command Palette → *Extensions: Install from VSIX…* and pick `dist/buildpilot.vsix`.

## First run (2 minutes)

1. Open your project folder in VS Code and click the **BuildPilot** icon in the Activity Bar.
2. Click **Connect** to let BuildPilot see Claude Code sessions. It shows exactly what it changes and backs up your settings first. (Want to look around first? *Connect → Load demo data*. Demo sessions are clearly labelled.)
3. Start Claude Code as usual (`claude` in a terminal). The session appears in **Sessions** within a second.
4. Follow the **Next step** card on **Overview**, or open **Prompts** and describe what you want.

## The six tabs

| Tab | What it's for |
|---|---|
| **Overview** | Next step · what's happening · anything wrong · project summary, stage, progress vs. requirements, tests, Git |
| **Sessions** | Every observed Claude Code session: status, current task, timeline, changed files, errors, tokens, overlaps |
| **Supervisor** | Issues (with evidence), ranked recommendations, run tests/build, ship-readiness checklist, environment doctor, checkpoints & scoped rollback |
| **Prompts** | Prompt Studio: pick a goal (feature, bug, integration, tests, refactor, UI, security, deploy, performance, explain, handoff), describe it, get a best-practice prompt. **Copy** it, or **Start in Claude Code** (opens a terminal running `claude` with it, after you confirm) |
| **Memory** | Goal, requirements with acceptance criteria, decisions, preferences, session handoff, CLAUDE.md draft, data deletion |
| **Connect** | Claude Code connection, phone/glasses/Slack alerts, Integration API, optional AI refinement, beginner mode |

## Phones, smart glasses and other tools

- **Alerts anywhere:** *Connect → Set up notifications* sends short alerts ("Claude needs your approval", "Tests failing") to ntfy (phone push), Slack, Discord or any webhook. Smart glasses that announce phone notifications (e.g. Meta Ray-Ban paired with your phone) will read them out. Only short alerts and the project name are sent, never code.
- **Ask BuildPilot from anything:** turn on the **Integration API** (token-protected, localhost by default). `GET /v1/brief?format=text` returns a one-sentence spoken-style status, for Siri Shortcuts, Raycast, Stream Deck, a glasses companion app, or a bot. `POST /v1/prompt` generates prompts. It's read-only: it cannot run commands or change files. See `docs/ARCHITECTURE.md#integration-api`.

## Command line (same engine, no VS Code)

```bash
node dist/cli.js status [folder]      # stage, health, issues, next step
node dist/cli.js sessions [folder]    # observed Claude Code sessions
node dist/cli.js brief [folder]       # one-line status
node dist/cli.js handoff [folder]     # context handoff for a new session
node dist/cli.js prompt bugfix "Checkout page is blank after paying" [folder]
node dist/cli.js hooks status|install|uninstall [--project <folder>]
node dist/cli.js serve [folder]       # Integration API without VS Code
```

## What BuildPilot will never do
- Pretend: unknown things say **Unknown**; inferred things say **Inferred**; progress only counts requirements proven by a passing test.
- Act without asking: running scripts, starting Claude Code, checkpoints, rollbacks, writing files and sending to AI all require a confirmation.
- Destroy work: no resets, force-pushes or deletions. Checkpoints don't touch your branch, index or files. Rollback is per-file and takes a safety checkpoint first.
- Send your code anywhere.

More: [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Features](docs/FEATURES.md) · [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [Roadmap](docs/ROADMAP.md) · [Decisions](docs/DECISIONS.md) · [Progress](docs/PROGRESS.md)

_Designed & built by Mohil Gupta._
