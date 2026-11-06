# Architectural decisions

**D-001 VS Code extension + in-process engine + CLI, not a separate daemon.** The engine is a plain TypeScript library (`src/core`) hosted by the extension and also by `dist/cli.js`. A separate always-on daemon adds install, lifecycle and auth complexity with little gain, because events are captured even while VS Code is closed (D-002). The "local service" can still be started and stopped in either host.

**D-002 Hooks write to a file spool, not to an HTTP port.** Async command hooks append each payload to `~/.buildpilot/spool` (0700). Pros: no listening socket to secure, zero added latency for Claude Code, events survive VS Code being closed, works identically on all OSes where Claude Code runs a POSIX shell (Windows Claude Code uses Git Bash). Cons: requires `sh`, `mktemp`, `head`, `mv`. Rejected: `http` hooks (lose events when VS Code is closed, need port + auth).

**D-003 sql.js (WASM SQLite) instead of better-sqlite3 / node:sqlite.** No native rebuild per Electron ABI; works in every VS Code version and in plain Node for the CLI and tests. Single writer (the engine), so whole-file atomic flushes are fine at these sizes; retention keeps the DB small.

**D-004 Deterministic rules first; AI optional and never automatic.** Every judgment in v0.1 is a pure, tested rule with evidence. AI (Anthropic API with the user's own key, or local Ollama) is only used for "Refine with AI", after a confirmation showing what will be sent. No LLM calls per event.

**D-005 Honest metrics.** Context % and cost are not computed: window size varies by model/plan and subscriptions have no per-token price. We show tokens from local transcripts labelled as estimates; cost = Unknown.

**D-006 Progress only counts verified requirements.** Manually checked items stay "Unverified" until a passing test run after they were marked done.

**D-007 Checkpoints via temporary index + private refs.** `git add -A` into a temp `GIT_INDEX_FILE`, `write-tree`, `commit-tree`, `update-ref refs/buildpilot/checkpoints/<ts>`. Captures untracked files; never touches the user's index, HEAD, branch or files. Rollback is per-file `git restore --source` after a safety checkpoint.

**D-008 Plain-DOM webview.** No React: one view, ~35 KB bundle, strict CSP, fast. State is re-rendered from a single snapshot.

**D-009 Integration API off by default, loopback, token, read-only.** External devices get summaries, not control.

**D-010 Canonical paths.** Projects are stored by `realpath` because Claude Code reports real paths (found in live testing: macOS `/var` → `/private/var`).

**D-011 node:sqlite (WAL) as the primary store; sql.js as fallback.** Several BuildPilot processes run at once (one per VS Code window, plus the terminal `bp`). Whole-file sql.js flushes would let them overwrite each other and split spool events. VS Code ships Node 24 and system Node 22 both include `node:sqlite`, so every statement is written directly to one WAL-mode database with a busy timeout. Duplicate events are guarded by `INSERT OR IGNORE` on the fingerprint, so two processes draining the spool at once record each event exactly once (tested). sql.js remains for runtimes without node:sqlite.

**D-012 Terminal presence via a sourced shell file, not a daemon.** `~/.zshrc` gets a 3-line marked block that sources `~/.buildpilot/shell.sh` (the `bp` function + a glance in interactive TTYs only). The glance reads saved state and never runs project analysis (~0.3 s). The CLI is copied to `~/.buildpilot/bin/` so upgrades never break the path. Removal restores the rc file exactly.

**D-013 Injected prompts are not tasks.** Claude Code submits system messages (other sessions, background tasks, expanded pastes) through UserPromptSubmit. They're labelled, and never replace the user's last real request as a session's "current task".

**D-014 Menu-bar widget is a native SwiftUI app that runs BuildPilot's own CLI.** A tiny `MenuBarExtra` app (~350 KB, universal, macOS 13+) instead of Electron (about 200 MB) or a second engine. It runs `cli.js widget` (the same fast path as the terminal glance: it drains new hook events and does no analysis, about 0.1 s). It refreshes when the spool or status folder changes (FSEvents, debounced) and every 30 s. It uses a real Node if one exists, otherwise VS Code's own runtime (`ELECTRON_RUN_AS_NODE`), so it works without Node installed. It ships zipped inside the VSIX and is installed into `~/Applications` by the extension or installer (no admin, no Gatekeeper prompt). Start-at-login is a user LaunchAgent. Everything is reversible (the app goes to the Trash).

**D-015 Store name "BuildPilot for Claude Code"; extension id derived from package.json.** "BuildPilot" is taken on the Marketplace (an unrelated Jenkins tool), and display names must be unique. The publisher id is a placeholder until the user creates one, so `src/core/extId.ts`, the widget config and the Desktop scripts all derive `publisher.name` from `package.json`.
