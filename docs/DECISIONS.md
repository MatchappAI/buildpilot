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
