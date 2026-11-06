# BuildPilot vs. what you already have

Honest version. If one of these covers you, use it.

| You want… | Claude Code alone (`/usage`, `/cost`, status line) | ccusage (free CLI) | Claude Squad / Crystal / Conductor | **BuildPilot** |
|---|---|---|---|---|
| See every running Claude chat across all your projects, and which one is waiting for you | One terminal at a time | — | Yes, inside their own app/TUI | **Yes**, one page beside your terminal, plus menu bar, `bp tmux` and `/bp` |
| Plan limit % and reset time | Yes (`/usage`, status line) | Yes (from logs) | — | Yes, plus **when you'll run out at your current pace** and the wait until it's back (Pro) |
| Which build is using your limit | — | Per project/day from logs | — | Per running build, live (Pro); per-build $ for API-key users (free) |
| Tips that fire on what's actually happening (chat nearly full, stuck in a loop, two builds in one folder, no undo) | — | — | — | **Yes**, each with one button (Start fresh chat, Turn on undo, …) |
| Start another build in its own copy of the project | Manual `git worktree` | — | **Yes**, with diff/merge views | Yes (`+ New build`, `bp new`; copies .env, installs packages, opens Claude). Merge is plain `git merge`; no diff UI yet |
| Plain-English → structured prompt with project context and "settle these first" questions | — | — | — | Yes (20 free, unlimited on Pro) |
| Non-technical friendly (no jargon, one page, undo set up for you) | — | — | Developer-oriented | **The main goal** |
| Data leaves your machine | No | No | Varies | **No** (local only; optional 4 anonymous counts, off by default) |

**Where BuildPilot is weaker:** no diff/merge view for parallel builds (Claude Squad/Conductor have one), no team/seat plan, and the forecast is a straight-line estimate from your recent usage (shown only after ≥10 minutes of data).
