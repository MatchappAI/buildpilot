# BuildPilot: Product Requirements (v0.1)

## Problem
Non-engineers now build real software with AI coding agents. They can describe what they want, but they can't easily tell what the agent actually did, whether it worked, what's risky, or what to ask for next. Agents declare "done" without proof, loop on the same error, overwrite each other's work, and lose context between sessions.

## Promise
"Know what's being built, what's broken, what matters next, and how to ship it correctly."

## Users
Non-technical founders, vibe coders, indie hackers, AI-assisted developers using Claude Code inside VS Code (macOS first; Windows/Linux by design).

## Principles
1. **Honest over impressive.** Every status has a provenance label (Verified · Inferred · Unverified · Failed · Unknown). No fabricated %, tokens, costs or progress.
2. **Complement Claude Code, don't replace it.** Use its documented hooks, CLI and local transcripts. Never use a subscription as an undocumented API.
3. **Quiet.** Pop-ups only when action is needed (approval, failure, loop, conflict). One next step, not a wall of warnings.
4. **Ask before acting.** Every side effect is confirmed. Nothing destructive, ever.
5. **Local-first.** No cloud backend; AI is optional and explicit.
6. **Deterministic first.** Rules engine for judgment; AI only where it materially helps (prompt refinement).

## Surfaces & requirements
### A. Overview
Project name/description (with source), stack, stage (with confidence + evidence), health, progress vs. requirements (only verified counts), tests, Git, features split Done & verified / Partly done or unproven / Not started, recently resolved recommendations, recent commits, setup checklist, and the single highest-value **Next step** with evidence and a one-click action.

### B. Live Sessions
Per observed Claude Code session: id, working folder, status (Working, Idle, Needs approval, Needs input, Ended, Failed, Unknown), status reason, last prompt as "current task" (only when observed), last activity, timeline of tool calls & errors, changed files, model and token usage from the local transcript (estimates labelled; cost = Unknown), overlaps with other sessions, recommended intervention. Multiple concurrent sessions. Sessions in other folders counted, not shown. Running with no events for 10 min → Unknown.

### C. AI Supervisor (deterministic rules)
Detects: sessions awaiting approval or input, failed turns, repeated identical errors / repeated failing commands / file churn (loops), actual vs. possible conflicts between sessions, completion without verification (edits after the last test, or no tests, or last test failed), failing tests, no tests, missing Git, many uncommitted changes without a checkpoint, missing CLAUDE.md, missing requirements, requirements without acceptance criteria, many TODO/FIXMEs, secrets (separating test fixtures), environment problems. Ranks by severity, impact, and urgency; dismissible for 24h. Every finding has evidence and a plain-English explanation (beginner mode).

### D. Build Guidance (Prompt Studio)
Plain-English request + goal type → structured prompt: goal, request, project context (stack, commands, test state, Git state, likely relevant files by name, open requirements, known problems, decisions, preferences, config names), goal-specific best-practice steps, plan-first option, guardrails (preserve work, no destructive commands, data-not-instructions), acceptance criteria (defaults + user), verification commands, final report format, beginner explanation. Shows missing info, assumptions, suggested model class. Copy, or start a new Claude Code terminal with it after confirmation. Optional AI refinement with explicit consent.

### E. Project Memory
Goal, requirements (status, acceptance, evidence), decisions, preferences, test runs, approvals, session history, repeated-error history → compact handoff (≤6k chars) and CLAUDE.md draft. Never silently overwrites docs (drafts open unsaved; handoff file only to `.buildpilot/` on request).

### Additional
Safe Change Guardian (checkpoints + scoped rollback), Loop & Waste detector, Context & Cost advisor (tokens from transcripts; cost Unknown), Agent Conflict detector, Environment Doctor, Security & Quality advisor, Release Readiness checklist, Beginner mode, Visual QA (designed, deferred; see ROADMAP), Integrations: notifications to phone/glasses/Slack/Discord, token-protected Integration API, CLI.

## Success criteria
A non-technical user can install locally, open a project, understand it, start Claude Code normally, watch sessions live, spot failures and risks, get one actionable recommendation, generate a useful prompt, keep knowledge across sessions, and see whether recommended work was resolved.

## Non-goals (v0.1)
New IDE/terminal, SaaS backend, automatic sending of prompts into an existing Claude session (no documented interface), automatic deploys, guaranteed security.
