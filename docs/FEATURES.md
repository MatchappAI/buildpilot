# Features: implemented · partial · planned

Legend: ✅ implemented and tested · 🟡 partial · ⏳ planned (see ROADMAP)

## Foundation
- ✅ Extension activates, sidebar renders, project = workspace folder or picked folder (remembered per workspace)
- ✅ Engine start/stop, SQLite persistence with migrations, corrupt-DB quarantine, retention
- ✅ Error, empty, loading, disconnected (hooks missing / Claude missing) and Restricted-Mode states
- ✅ CLI with the same engine

## Live sessions
- ✅ Safe hook install/uninstall (user or project scope), backup, idempotent, refuses invalid JSON
- ✅ Real event ingestion (verified with a live `claude -p` session: 8/8 events)
- ✅ Multiple concurrent sessions, lifecycle state machine, out-of-order safety, de-duplication, malformed quarantine
- ✅ Timeline, changed files (click to open), errors, last prompt as task, intervention hint
- ✅ Token usage from local transcripts (labelled estimate); cost shown as Unknown
- ✅ Staleness → Unknown; sessions from other folders counted
- 🟡 Model name: from transcript; Claude Code hook payloads didn't include it in our live test
- ⏳ Terminal ↔ session association (no reliable identifier exposed; deliberately not guessed)

## Supervisor
- ✅ Approval/input waiting, failed turns, loops (repeated error, repeated failing command, file churn), actual vs possible conflicts, unverified completion, failing tests, no tests, no Git, uncommitted work without checkpoint, missing CLAUDE.md, missing requirements/acceptance criteria, TODO load, secrets (fixtures separated), environment doctor
- ✅ Scored recommendations with evidence, one next step, dismiss for 24h, beginner explanations
- ✅ Verification loop: resolved recommendations recorded when their condition disappears
- ✅ Stage classification (inferred, with evidence) and progress only from verified requirements
- ⏳ Requirements-drift detection (compare prompts vs requirements), AI-assisted explanations

## Build guidance (Prompt Studio)
- ✅ 11 goal types with best-practice steps, acceptance criteria, clarifying questions, plan-first, model class
- ✅ Project context, guardrails, verification commands, final-report format, beginner explanation, untrusted-data fencing
- ✅ Missing info + assumptions surfaced; editable result; Copy; Start in Claude Code (new terminal, confirmed)
- ✅ Optional AI refinement (Anthropic key / Ollama) with per-use consent
- ✅ Prompt generation over Integration API and CLI
- ⏳ Sending into an already-running session (no documented interface)

## Memory
- ✅ Goal, requirements (status, acceptance, evidence), decisions, preferences, import checklists from docs
- ✅ Handoff (copy, as prompt, save to `.buildpilot/HANDOFF.md`), CLAUDE.md draft (opened unsaved, never overwrites)
- ✅ Delete project data / all data

## Safety & quality
- ✅ Checkpoints (no changes to branch/index/files), diff since checkpoint, scoped per-file rollback with safety checkpoint
- ✅ Run named package scripts / install only, confirmed, time-limited, recorded as evidence
- ✅ Release-readiness checklist (Verified/Failed/Unknown/Unverified)
- 🟡 Security: high-confidence secret scan, tracked `.env`, missing env names. ⏳ dependency vulnerability audit (`npm audit` needs network; planned as an approved action)
- 🟡 Environment doctor: Node version vs engines/.nvmrc, deps installed, lockfile conflicts, missing scripts, env names. ⏳ Python/Go/Rust specifics

## Integrations
- ✅ Alerts: VS Code (important only) + webhook (ntfy, Slack, Discord, generic JSON), URL in SecretStorage
- ✅ Integration API (token, loopback default, optional LAN, read-only)
- ⏳ Native smart-glasses companion app (Meta Wearables Device Access Toolkit is phone-side); statusline integration for exact context %

## Visual QA
- ⏳ Launch app + screenshots + journey checks (interface designed in ROADMAP; BuildPilot's own UI is screenshot-tested via `test/ui`)
