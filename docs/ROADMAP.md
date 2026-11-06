# Roadmap (prioritized)

1. **Field test with real users** (next): install on 3–5 vibe coders' machines, watch where they hesitate; tune rule thresholds (loop = 3 identical errors/hour, churn = 8 edits, stale = 10 min) from real data.
2. **Dependency vulnerability check** as an approved action (`npm audit --json` / `pip-audit`), summarized in plain English.
3. **Requirements drift**: flag prompts whose topic matches no requirement; suggest adding one.
4. **Exact context usage**: optional Claude Code statusline integration (documented `context_window` fields), merged without overwriting a user's statusline.
5. **Visual QA v1**: `VisualCheck { url, steps[], screenshot }` interface; launch `npm run dev`, wait for port, capture screenshots with an installed browser, attach to readiness. Keep small.
6. **AI explanations (opt-in)**: summarize a long session timeline or error cluster on demand, with the same consent flow.
7. **Smart-glasses companion**: a minimal iOS/Android app using Meta's Wearables Device Access Toolkit that reads `/v1/brief` aloud and can trigger "copy prompt"; until then, ntfy notifications + Shortcuts.
8. **Windows/Linux verification**: run the smoke suite on Windows (PowerShell + Git Bash) and Linux; signed VSIX.
9. **Worktree assistant**: one-click "give this session its own worktree" when a conflict is detected (approval required).
10. **Marketplace publishing** (requires approval and a publisher account).
