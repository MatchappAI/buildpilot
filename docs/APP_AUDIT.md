# App audit: feature inventory (2026-11-16, v0.12.4)

How each surface was checked: **run** = exercised for real (CLI in a throwaway HOME, window in headless Chrome against the real `bp ui` server, git flows in scratch repos); **unit** = automated test; **read** = code review only.
Status: ✅ working · 🟡 partial · ⛔ broken (none left open) · 🚫 not run (blocked by the no-visible-windows rule or credentials).

| Surface | Feature | Status | How checked |
|---|---|---|---|
| CLI | `bp` / `status`, `brief`, `sessions`, `handoff` | ✅ | run (repo, non-repo, home dir, unicode folder) |
| CLI | `glance`, `today`, `limits`, `tmux`, `widget` (JSON), `recent` | ✅ | run, with 0 / 3 / 20 sessions and 20,020 events (≈0.1 s each) |
| CLI | `go [name]`, `jump` | ✅ | run (no sessions, no match, match without a terminal) — tab switching itself not run (would focus a window) |
| CLI | `who <file>` | ✅ | run + e2e |
| CLI | `new`, `builds`, `review`, `merge` (clean + conflict), `done` | ✅ | run in scratch repos: merge brings work in, conflict aborts with nothing changed, done keeps the branch |
| CLI | `prompt <goal>`, `prompt auto`, `prompt auto --stdin` (new) | ✅ | run + unit (hostile text) |
| CLI | `hooks` / `statusline` / `shell` status·install·uninstall, `--project`, `--json` | ✅ | run: idempotent, refuses invalid settings JSON, restores the owner's own status line byte-for-byte |
| CLI | `doctor [--fix] [--json]` | ✅ (fixed `--json`) | run + unit |
| CLI | `license [key]` | ✅ | run: none / garbage / bad signature / env key; valid-key path unit-tested with a test key pair |
| CLI | `bar status/install/uninstall` | 🟡 | status run; install/uninstall unit-tested in a sandbox (real install would put an icon in the menu bar) |
| CLI | `audit`, `visual [url]` | ✅ | run (unreachable URL message) |
| CLI | `serve` (Integration API), Pocket page | ✅ | run: 401 without token, 200 with token, Pocket static |
| CLI | `open` (VS Code link), `ui` launcher | 🟡 | usage paths run; launching VS Code / Chrome app window not run (visible) — `ui --print` used instead |
| Window | Connect card, See what changes, Connect, Disconnect | ✅ | e2e: settings file checked after each |
| Window | Session list, needs-you banner, expand, steps, rename, Looks fine | ✅ | e2e with seeded hook events |
| Window | Go to tab / Resume / Start fresh | ✅ | e2e (OS action logged, not performed) |
| Window | Who changed a file + Undo this file | ✅ | e2e: file restored, safety ref created |
| Window | Write my prompt → Start Claude / Copy / Use in my open Claude | ✅ | e2e (terminal command + prompt file checked) |
| Window | Side builds: New, Review, Merge (tests first), Remove | ✅ | e2e: worktree, merge commit, folder removed, branch kept |
| Window | Plan limits, tips, trial/paywall, license key | ✅ | jsdom + free-plan e2e |
| Window | Theme (white default / Auto), Alerts toggle, Advanced tools, project picker | ✅ | e2e |
| Window | Security: launch code single-use, token header, foreign origin, DNS rebinding, body cap, path traversal | ✅ | e2e + unit |
| Window | Accessibility (axe WCAG 2.2 AA + best-practice), keyboard names, 375 px reflow | ✅ | e2e: 0 violations (first run, with sessions) |
| Engine | Hook ingest, redaction, state machine, dedupe, malformed/oversize events, concurrency | ✅ | run: 300 events from 6 writers + 8 readers → 300 stored, 0 lost; spool cap keeps status events |
| Engine | Corrupt / zero-byte / read-only database | ✅ | run: quarantined and restarted; read-only home still answers |
| Engine | Missing git, non-repo folders | ✅ | run |
| Plugin | Slash commands | 🟡 | command files tested, `bp.sh` run directly; not run inside a real Claude Code session (would write into the owner's real data) |
| Plugin | Hooks (`spool.sh`), status line script | ✅ | run with fake payloads, chained status line |
| Widget | Menu-bar app + floating panel | 🚫 | rendering puts a window on screen; data feed (`bp widget`) verified |
| VS Code | Extension | 🟡 | same page bundle click-tested in jsdom; extension host smoke 🚫 (opens VS Code) |
| Server | License Worker (`server/`) | 🚫 | live, not touched by instruction (no redeploy); unit tests unchanged |
| Pricing | Stripe checkout | 🚫 | placeholder link → Pro unlocked for all until the owner adds a Payment Link |

Fake-success / silent-failure review: the only "looked done but wasn't" behavior found was the toast wipe (#3) and the uncounted/over-counted prompt (#5). Nothing reports success without doing the work; every window action was checked against its real outcome (file, git, settings, OS log).
