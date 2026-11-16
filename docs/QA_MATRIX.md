# QA matrix (2026-11-16, v0.12.4)

Feature → action → expected → method → actual → status. Methods: **E2E** = `npm run test:e2e` (real `bp ui` server + headless Chrome, throwaway HOME, OS side effects logged not performed) · **CLI** = sweep scripts in a throwaway HOME (outputs in the audit transcript) · **U** = vitest (`npm run ci`).

| Feature | Action | Expected | Method | Actual | Status |
|---|---|---|---|---|---|
| Window auth | GET / without launch code; POST without token | 401 | E2E | 401 / 401 | pass |
| Window auth | foreign Origin; Host: evil.example | 403 | E2E | 403 / 403 | pass |
| Window auth | reuse launch code | 401 | E2E | 401 | pass |
| Window input | 400 KB body; bad JSON; `/media/../` | 413; error; 404 | E2E | 413; 500 (no crash, no effect); 404 | pass (bad JSON → 500 not 400: cosmetic) |
| Connect | preview / cancel / continue / repeat | no write / no write / hooks+status line / unchanged | E2E | as expected, 16 events | pass |
| Sessions | seeded hook events | needs-you first, reason shown, XSS escaped | E2E | as expected | pass |
| Sessions | expand, Looks fine, rename (+cancel), Go to tab | details + aria-expanded; risk hidden; name in window and `bp glance`; "Looking…" then explanation | E2E | as expected | pass |
| Files | Who changed + Undo this file | listed; restored; safety ref | E2E | as expected | pass |
| Prompt | write → Start (cancel, then confirm) → Copy | no terminal on cancel; terminal in project with `claude "$(cat '<file>')"`; clipboard logged | E2E | as expected | pass |
| Pricing | free plan: write / cancel / confirm | count 0 / 0 / 1 | E2E (ui-free) | 0 / 0 / 1 | pass |
| Pricing | 21 CLI prompts; 3rd side build | paywall at 21st; paywall | CLI | as expected | pass |
| Prefs | Alerts toggle; theme toggle | label + aria-pressed + ui.json; white ↔ auto, bg #fff | E2E | as expected | pass |
| Side builds | New → Review → Merge → Remove | worktree + terminal; file listed; merged with tests; folder gone, branch kept | E2E | as expected | pass |
| Side builds | conflicting merge (CLI) | nothing changes, conflict listed, exit 1 | CLI | as expected | pass |
| A11y | axe WCAG 2.2 AA + best-practice (first run, sessions) | 0 violations | E2E | 0 / 0 | pass |
| A11y | keyboard names; Escape closes dialog; 375 px | all named; closes; no h-scroll | E2E | as expected | pass |
| Disconnect | confirm | hooks + status line removed | E2E | as expected | pass |
| CLI | every command + bad input | plain usage, exit 2 for usage errors | CLI | as expected | pass |
| CLI | `doctor --json` | JSON | U + CLI | JSON | pass (was text) |
| Settings | broken JSON | refuse, untouched | CLI | untouched | pass |
| Settings | own status line + own hook | kept; restored exactly on uninstall | CLI | `restored exactly: true` | pass |
| Ingest | 6 writers × 50 + 8 concurrent readers | 300 stored, 0 left | CLI | 300 / 0 | pass |
| Ingest | >2000 unread | tool steps dropped, status kept | CLI + U | 2006 | pass |
| Ingest | malformed / 1 MB+ / path-like session id / unknown event | rejected (redacted copy) / truncated → rejected / rejected / ignored | CLI + U | as expected, no key in rejected | pass |
| Ingest | secret in prompt | `[REDACTED ANTHROPIC KEY]` everywhere, 0 rows with key | CLI | 0 | pass |
| DB | zero-byte, garbage, read-only home | fresh DB; quarantined `.corrupt-*`; read-only answers | CLI | as expected | pass |
| Env | git missing | plain "install Git" message | CLI | as expected | pass |
| Perf | 20,020 events / 20 sessions | glance/widget/today/limits < 0.3 s | CLI | 0.10–0.13 s | pass |
| Plugin | hostile `/bp-prompt` text | never executed | U | marker file absent | pass |
| Plugin | `bp.sh` without Node | one plain sentence | U | as expected | pass |
| API | `bp serve` endpoints | 401 without token, 200 with | CLI | as expected | pass |
| Widget | menu-bar app / floating panel | — | — | — | not run (would show on screen) |
| VS Code | extension host smoke | — | — | — | not run (opens VS Code; owner's call) |
| Plugin | commands inside real Claude Code | — | — | — | not run (would write into the owner's real data) |
| License Worker / Stripe | live purchase | — | — | — | blocked (live infra, placeholder Payment Link) |

Totals this audit: **254/254 unit tests**, **34/34 window e2e**, **7/7 free-plan e2e**, ~110 CLI/edge checks passed, 0 failed; 4 areas not run / blocked (above).
