# Audit changelog (branch `audit/2026-11-16`)

1. `b7624e6` Reviewed and kept the unfinished 2026-11-08 pass (plain words: sessions not builds, toasts announced to screen readers, Alerts state, stuck tip only for visible sessions, empty project picker explains itself).
2. `362375f` Toasts survive live refresh · prompt counted only after a confirmed send · white page by default + working Auto light/dark · `bp doctor --json` · stale "Connect" step hidden once connected · glance shows session names · prompt files pruned · `BUILDPILOT_OS_LOG` test seam (global in vitest).
3. `ddcd786` Plugin commands never run user text as shell (`/bp-prompt` via stdin heredoc, `bp prompt auto --stdin`; names single-quoted) · rejected events stored short + redacted, pruned · quoted side-build names · no-Git message · `bp serve` real port.
4. `28a86ca` `bp ui` never stops a recycled pid · side builds refresh on their own · project picker allow-list · sibling-folder handoff fix.
5. (this commit) v0.12.4 · "Go to tab" immediate feedback · headless window e2e committed as `npm run test:e2e` (safe: no visible window, no clipboard/Terminal) · audit docs.

Each fix: reproduced (sweep or e2e) → root cause → smallest fix → re-run → regression test (see ISSUE_TRACKER.md).
