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
