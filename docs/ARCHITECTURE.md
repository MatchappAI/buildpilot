# Architecture

```
 Claude Code session(s)                      VS Code
 ──────────────────────                      ─────────────────────────────────────────────────
 hooks (async command)  ──► ~/.buildpilot/spool/*.json ──► SpoolReader ─► Ingestor ─► SQLite (sql.js)
   hook.sh: cat stdin → file, exit 0                          (fs.watch + 3s poll)      ~/.buildpilot/buildpilot.db
 transcripts ~/.claude/projects/*.jsonl ───────────────► transcript.ts (usage, read-only)
                                                                         │
 project folder ──► analyzer / doctor / secret scan / git ──────────────►│
                                                                         ▼
                                                     Engine.snapshot() → supervise() (pure rules)
                                                         │          │             │
                                     Webview (sidebar) ◄─┘   IntegrationApi (opt-in)   Alerts → VS Code pop-up / webhook
                                     Prompt Studio ─► Copy / `claude "<prompt>"` in a new terminal (confirmed)
```

## Layers (data provenance)
1. **Observed facts**: hook events, git status, files, test runs BuildPilot executed, transcript usage.
2. **Derived inferences**: session display status (incl. staleness → Unknown), stage, loops, conflicts, unverified completion.
3. **Recommendations**: `source: "rules"` (all of v0.1); AI only refines prompts on request.
4. **User-approved actions**: `approvals` table (run_script, checkpoint, start_claude).
5. **Verified outcomes**: test runs; requirements become `verified` only after a passing test run; recommendations recorded as resolved when their condition is no longer observed.

## Components
| Module | Responsibility |
|---|---|
| `hooks.ts` | Installs `async` command hooks for 13 documented events into user (`~/.claude/settings.json`) or project (`.claude/settings.local.json`) settings. Refuses invalid JSON, backs up, preserves everything, idempotent, reversible. `hook.sh` is POSIX sh, writes atomically via `tmp/` + `mv`, caps 1 MB, no output, no-op if BuildPilot removed. |
| `ingest.ts` | Validates payloads (ids, types), clips + redacts, de-duplicates by SHA-256 of payload, ignores out-of-order status regressions, session state machine, spool draining with quarantine of malformed files. |
| `db.ts` | sql.js SQLite, versioned migrations (`PRAGMA user_version`), atomic debounced writes (0600), corrupt-file quarantine, retention (30 days / 2000 events per session), deletion APIs. |
| `supervisor.ts` | Pure rule functions → issues, recommendations (scored), readiness, stage, progress, session views. |
| `prompts.ts` | 11 goal specs (best practices, acceptance, questions, plan-first, model class) + prompt builder + relevance by file name. |
| `memory.ts` | Bounded handoff and CLAUDE.md draft. |
| `engine.ts` | Owns store, spool, project, analysis cache, approved actions (named scripts only, `checkpoint`), alerts with 30-min de-dup, demo data, verification loop. Emits `changed` (coalesced 300 ms) and `alert`. |
| `api.ts` | Integration API + webhook formats. |
| `ai.ts` | Optional Anthropic Messages API (user key in SecretStorage) / local Ollama. |
| `extension.ts` | Confirmations, workspace trust, terminal launch, status bar, notifications, settings, commands. |
| `webview/` | Single sidebar webview; strict CSP (nonce script, no remote); theme tokens only. |

## Session status model
`SessionStart`→Idle · `UserPromptSubmit`/tool events/`PreCompact`/subagents→Working · `PermissionRequest` or `Notification(permission_prompt)`→Needs approval · `Notification(idle_prompt)`→Idle · `Notification(agent_needs_input|elicitation…)`→Needs input · `Stop`→Idle ("finished its last response") · `StopFailure`→Failed · `SessionEnd`→Ended. Display-time: Working with no events for 10 min → Unknown; anything idle >12 h → Unknown. A session id is not assumed to equal a terminal; terminals are never inferred.

## Integration API
Off by default. `127.0.0.1:47821` (LAN only if `integrationApi.allowLan`). `Authorization: Bearer <token>` from `~/.buildpilot/api-token` (0600, constant-time compare). No CORS headers.
- `GET /v1/brief[?format=text]`: 1–3 sentence status for voice/glasses
- `GET /v1/status`: stage, health, progress, top issues, next step
- `GET /v1/sessions`: status, reason, task, last activity, needs-you
- `GET /v1/next` · `GET /v1/goals` · `GET /v1/health`
- `POST /v1/prompt {"goal","request"}`: generated prompt, missing info, assumptions

Example (iOS Shortcut / glasses companion): `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:47821/v1/brief?format=text`

**Smart glasses:** Meta's glasses don't run third-party code directly; third-party access goes through a phone app (Meta's Wearables Device Access Toolkit). Today's working paths are (1) phone notifications via ntfy/Slack/Discord webhooks, which glasses paired to the phone can announce, and (2) a phone app or Shortcut calling `/v1/brief` (with LAN access enabled on a trusted network, or through the user's own tunnel/VPN). A native glasses companion app is on the roadmap.

## Prompt hand-off to Claude Code
Supported: start a new session with `claude "<prompt>"` (documented CLI). BuildPilot writes the prompt to `~/.buildpilot/prompts/*.md` (0600) and runs `claude "$(cat file)"` (PowerShell: `Get-Content -Raw`; cmd.exe: start `claude` and put the prompt on the clipboard). Injecting text into an *existing* interactive session has no documented interface, so BuildPilot offers Copy instead.
