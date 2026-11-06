# Security & privacy

## Data
- Stored only in `~/.buildpilot/` (dir 0700; DB, token, prompts 0600). Override with `BUILDPILOT_HOME`.
- Hook payloads are validated, clipped and **redacted** (API keys, tokens, JWTs, private keys, DB URLs, `*_SECRET=` assignments) before storage. Tool outputs (`tool_response`) are not stored.
- `.env` files: only variable **names** are read; values never leave the parser.
- Transcripts: read only from inside the Claude config directory (path-checked); only usage numbers/model are kept.
- Retention: 30 days, ≤2000 events per session. Delete per project or everything from Memory → Your data.

## Untrusted content
Repository files, prompts, errors and hook payloads are data. They're never executed or followed; in generated prompts they're fenced in `<project_data>` with an instruction to treat them as data. Webview output is HTML-escaped; strict CSP (nonce scripts, no remote resources).

## Actions
Every side effect needs a confirmation that states exactly what happens: running a package script (by name only, never arbitrary commands), installing deps, starting Claude Code, saving a checkpoint, restoring files, writing `.buildpilot/HANDOFF.md`, sending to an AI provider, enabling webhooks. All processes use `execFile` with argument arrays and timeouts. Scripts, terminals and file writes are disabled in VS Code Restricted Mode.

## Git
No reset, clean, checkout, force-push, branch deletion or history rewrite. Checkpoints are private refs built from a temporary index. Rollback restores only the files the user selects, after a safety checkpoint, and rejects absolute or `..` paths.

## Claude Code configuration
Install merges into settings (preserving all keys and hooks), writes a timestamped backup to `~/.buildpilot/backups/`, refuses to touch invalid JSON, is idempotent, and uninstall removes only BuildPilot's entries. Hooks are `async`, print nothing and exit 0, so they can't block or alter Claude Code.

## Network
- Default: none. (Exceptions only when enabled by the user: Integration API, webhooks, AI provider.)
- Integration API: loopback by default; LAN opt-in with warning; bearer token (192-bit, constant-time compare, rotatable); no CORS; read-only.
- Webhooks: https only; payload = alert title/message + project name.
- AI: Anthropic key in VS Code SecretStorage; only the prompt text shown is sent, after confirmation. Claude Code's subscription is never used as an API.

## Limits
The secret scan uses high-confidence patterns and is not a security audit. Readiness "Verified" means a specific check passed, not that the product is secure or production-ready.

## Hooks, spool and retention (v0.5)
- **Connect** adds 13 async command hooks and a status-line reporter to `~/.claude/settings.json`. "See exactly what changes" shows the exact JSON first. Your settings are backed up, and Disconnect removes exactly these lines. If you already have a status line, it keeps working (BuildPilot chains it).
- The hooks copy each event Claude Code sends (up to 1 MB) into `~/.buildpilot/spool`. They never block Claude, never print, and stop writing if more than 5000 events are waiting unread.
- BuildPilot reads each spool file, validates it, redacts secrets, stores a short log (tool names, commands, file names, errors; no file contents) in `buildpilot.db`, and **deletes the spool file**. The log is pruned at 30 days or 2000 events per session.

## Licenses and payments
- Pro keys are Ed25519-signed and checked offline. The extension contains only the public key, so keys can't be forged from the code.
- The checkout link carries a random install id (`client_reference_id`) so the license Worker can match a payment to a key. It identifies nothing else.
- The Worker stores only `session id → key`. It never sees your code, prompts or projects.

## Anonymous counts (opt-in)
- Off by default. Three days after install, BuildPilot asks once in a notification.
- If you say yes, it sends 4 events once each: installed, connected, still using after 7 days, upgraded. Each event carries a separate random id used only for counts, so it can't be linked to the checkout id. Nothing else is sent: no names, paths, prompts, code or IPs stored.
- The answer is stored in `~/.buildpilot/counts.json`. Delete the file to be asked again.
