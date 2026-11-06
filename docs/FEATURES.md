# Features: implemented · partial · planned

Legend: ✅ implemented and tested · 🟡 partial · ⏳ planned (see ROADMAP)

## Foundation
- ✅ Extension activates, sidebar renders, project = workspace folder or picked folder (remembered per workspace)
- ✅ Engine start/stop, SQLite persistence with migrations, corrupt-DB quarantine, retention
- ✅ Error, empty, loading, disconnected (hooks missing / Claude missing) and Restricted-Mode states
- ✅ CLI with the same engine

## Onboarding & delivery
- ✅ Getting Started walkthrough (opens once on first run; Command Palette → BuildPilot: Getting Started)
- ✅ Desktop folder: 13-page START HERE guide, one-click install/uninstall scripts (sandbox-tested: uninstall restores Claude settings byte-for-byte; data goes to Trash)

## Live sessions
- ✅ Safe hook install/uninstall (user or project scope), backup, idempotent, refuses invalid JSON
- ✅ Real event ingestion (verified with a live `claude -p` session: 8/8 events)
- ✅ Multiple concurrent sessions, lifecycle state machine, out-of-order safety, de-duplication, malformed quarantine
- ✅ Timeline, changed files (click to open), errors, last prompt as task, intervention hint
- ✅ Token usage from local transcripts (labelled estimate); cost shown as Unknown
- ✅ Staleness → Unknown
- ✅ **Other projects**: active sessions in other folders listed (status, task, context %), included in brief/Pocket/API; approval alerts from any folder
- ✅ Exact context %, window size, Claude Code's own cost estimate (labelled "at list price"), 5-hour/7-day rate-limit % via the documented status-line JSON. Chains (never replaces) an existing status line; uninstall restores it exactly
- 🟡 Model name: from transcript/status line; hook payloads don't include it
- ⏳ Terminal ↔ session association (no reliable identifier exposed; deliberately not guessed)

## Supervisor
- ✅ Approval/input waiting, failed turns, loops (repeated error, repeated failing command, file churn), actual vs possible conflicts, unverified completion, failing tests, no tests, no Git, uncommitted work without checkpoint, missing CLAUDE.md, missing requirements/acceptance criteria, TODO load, secrets (fixtures separated), environment doctor
- ✅ Scored recommendations with evidence, one next step, dismiss for 24h, beginner explanations
- ✅ Verification loop: resolved recommendations recorded when their condition disappears
- ✅ Stage classification (inferred, with evidence) and progress only from verified requirements
- ✅ Requirements drift: recent prompts that match no requirement
- ✅ Context-full (≥80%) → handoff recommendation; 5-hour limit ≥85% warning
- ✅ "Explain with AI" per session (opt-in, redacted event digest only, consent each time)
- ✅ Conflict → "Separate the sessions": creates a Git worktree on a new branch, opens a terminal there, handoff prompt on clipboard

## Build guidance (Prompt Studio)
- ✅ 11 goal types with best-practice steps, acceptance criteria, clarifying questions, plan-first, model class
- ✅ Project context, guardrails, verification commands, final-report format, beginner explanation, untrusted-data fencing
- ✅ Missing info + assumptions surfaced; editable result; Copy; Start in Claude Code (new terminal, confirmed)
- ✅ Optional AI refinement (Anthropic key / Ollama) with per-use consent
- ✅ Prompt generation over Integration API and CLI
- ✅ "Start in Claude Code" launch command verified to pass hostile prompts as one exact argument (no evaluation)
- ⏳ Sending into an already-running session (no documented interface)

## Memory
- ✅ Goal, requirements (status, acceptance, evidence), decisions, preferences, import checklists from docs
- ✅ Handoff (copy, as prompt, save to `.buildpilot/HANDOFF.md`), CLAUDE.md draft (opened unsaved, never overwrites)
- ✅ Delete project data / all data

## Safety & quality
- ✅ Checkpoints (no changes to branch/index/files), diff since checkpoint, scoped per-file rollback with safety checkpoint
- ✅ Run named package scripts / install only, confirmed, time-limited, recorded as evidence
- ✅ Release-readiness checklist (Verified/Failed/Unknown/Unverified)
- ✅ Security: high-confidence secret scan (fixtures separated), tracked `.env`, missing env names, dependency audit (`npm audit --json` / `pip-audit`, approved action, verified live)
- 🟡 Environment doctor: Node version vs engines/.nvmrc, deps installed, lockfile conflicts, missing scripts, env names. ⏳ Python/Go/Rust specifics

## Integrations
- ✅ Alerts: VS Code (important only) + webhook (ntfy, Slack, Discord, generic JSON), URL in SecretStorage
- ✅ Integration API (token, loopback default, optional LAN, read-only)
- ✅ **Pocket**: phone page at `/pocket` (status, sessions, Read aloud, auto-speak when something needs you), with audio through Bluetooth glasses or earbuds
- ⏳ Native smart-glasses companion app (Meta Wearables Device Access Toolkit is phone-side)

## Visual QA
- ✅ Visual QA v1: detect app address, optionally start the dev script in a visible terminal, check it loads (HTTP status, title, error-overlay text, blank page), headless Chrome/Edge screenshot shown in the sidebar; readiness item
- ⏳ Multi-step user journeys (clicks/forms)
