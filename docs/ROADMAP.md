# Roadmap (prioritized)

Done since v0.1: dependency audit, requirements drift, exact context % (status line), Visual QA v1, AI session explanations, worktree assistant, Pocket phone/glasses page.

1. **Field test with real users**: tune thresholds (loop = 3 identical errors/hour, churn = 8 edits, stale = 10 min, context 80%) from real usage.
2. **Visual QA v2**: scripted user journeys (click/type steps) via Chrome DevTools Protocol, before/after screenshot diffs around a checkpoint.
3. **Native smart-glasses companion**: a small iOS/Android app using Meta's Wearables Device Access Toolkit, reading `/v1/brief` and announcing changes; until then use Pocket + ntfy.
4. **Windows/Linux verification**: run `npm run ci` on Windows (PowerShell + Git Bash) and Linux; signed VSIX.
5. **pnpm/yarn/bun audits**: support their audit JSON formats.
6. **Lint toolchain**: move to ESLint 10 / typescript-eslint majors once stable to clear the remaining moderate dev-only advisories.
7. **Marketplace publishing**: needs your approval and a publisher account.
