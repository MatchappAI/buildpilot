# User journeys (2026-11-16)

Each journey: happy path, alternative, failure, recovery. ✅ = run end to end (headless window e2e or CLI sweep), 🧪 = unit test, 🚫 = not run (see reason).

1. **First run → connect** — open `bp ui` → Connect card → "See exactly what changes" (preview, nothing written) → Connect → Cancel (nothing written) → Connect → Continue (hooks + status line written, backup made) → page switches to sessions. Repeat Connect = no change (idempotent). Broken settings JSON = refused with a plain message, file untouched. ✅
2. **Watch sessions** — Claude starts → session appears within ~3 s → asks permission → "needs your OK" banner first + Mac alert (logged in tests) → answer → back to working → finishes → "your turn". Errors pile up → error chip + tip. Force-push → "worth a look" → Looks fine hides it until something new. ✅
3. **Name a session** — rename → name shows in the window, `bp glance`, `bp go <name>`; cancel keeps the old name; empty clears. ✅
4. **Write a prompt** — plain words → Write my prompt → edit → Start Claude with this → confirm (Terminal in the project, prompt passed as one argument from a private file) / cancel (nothing opens, not counted) → Copy / Use in my open Claude. Free plan: counted only when used; at 20 → paywall with checkout link. ✅
5. **Side builds** — New side build (name → confirm → own copy + branch + Terminal) → Claude edits → Review shows files (refreshes on its own) → Merge (tests first on Pro; failing tests ask again) → Remove (folder gone, branch kept). Conflict → nothing changes, fix prompt; no Git → plain message; no commit yet → "turn on undo". ✅
6. **Undo a file** — Who changed a file? → Undo this file → confirm → safety save point, file back to last commit. Only files a session edited can be undone. ✅
7. **Limits** — status line reports → 5-hour/weekly bars, run-out forecast, tips; API billing → "Spend today". 🧪 (no live rate-limit data in a throwaway home)
8. **Disconnect** — Disconnect → confirm → only BuildPilot's lines removed, own status line restored exactly. ✅
9. **Terminal-only user** — `bp`, `bp today`, `bp limits`, `bp go`, `bp who`; unknown command → suggestion + exit 2; not connected → one plain line on how to connect. ✅
10. **Plugin-only user** — `/bp`, `/bp-today`, `/bp-prompt` (text passed safely), `/bp-new`, `/bp-merge`, `/bp-ui`, `/bp-doctor`. Command scripts ✅; inside real Claude Code 🚫 (would touch the owner's real data).
11. **Upgrade** — paywall → Get Pro (opens checkout with a random install id, logged in tests) → paste key → valid unlocks / invalid explains, nothing saved. ✅ / real Stripe 🚫 (placeholder link).
12. **Recovery** — window server crashed / outdated → `bp ui` starts a fresh one; stale file never kills another app ✅. Database damaged → quarantined, fresh start ✅. Data folder read-only → read-only answers ✅. Window left open → polling continues; server exits after 15 min with no window ✅ (read).
13. **Multi-process** — window + terminals + widget reading/writing the same database at once: 8 readers + 6 writers, no lost events ✅. Alerts claimed once across apps 🧪.
