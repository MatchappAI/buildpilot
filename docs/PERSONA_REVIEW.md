# Persona review: 8 Claude Code user types × 3 rounds (2026-11-06)

**What this is:** 8 AI reviewers, each playing one type of Claude Code user. They did the same 5 tasks on screenshots of the real page (rendered from the real bundle), real terminal output, the real plugin files, and (for the skeptic) the real source code. They scored 7 items from 1 to 5, and I fixed what they found between rounds.

**What it is not:** proof that real users will install or pay. These are simulated users. Treat the scores as a structured usability review, not market data. For real evidence, see [VALIDATION.md](VALIDATION.md).

**Tasks:**
1. Install and connect.
2. Know whether you're about to hit your limit, and when it resets.
3. Start a parallel build.
4. Get and send a prompt for "add a contact form that emails me".
5. Run out of free prompts and decide whether to pay.

## The 8 personas
1. Non-technical founder, first app (Pro plan)
2. Designer/PM prototyping in Cursor (Max)
3. Indie hacker running 3+ builds in parallel (Max)
4. Skeptical staff engineer: API key, dark mode, security-minded
5. Agency developer juggling 6 client repos
6. Student on Pro who keeps hitting limits
7. Cursor user installing from Open VSX
8. Terminal-only user (tmux + neovim, plugin + `bp`)

## Scores (average of the 8)
| | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| Time to first value | 3.8 | 4.0 | **4.0** |
| Understands every word | 3.1 | 3.9 | **4.0** |
| Clutter (5 = none) | 4.6 | 4.6 | **4.6** |
| Trust and privacy | 3.8 | 4.1 | **4.4** |
| Finds the next step alone | 3.1 | 4.0 | **4.0** |
| Would install | 3.4 | 3.9 | **4.1** |
| Would pay $9/mo | 1.6 | 2.5 | **2.5** |

In round 3, **every persona scored at least 4 on every usability item.** **Willingness to pay is 2–3 out of 5.** All 8 final verdicts were "maybe: keep it free, not yet pay".

Caveat: some round-3 reviewers saw screenshots built from stale fixture text (old paywall bullets, the old "Start fresh" label, and no per-build $ on the API screen). The fixture now reads the shipped constants, and the screenshots were re-rendered after round 3.

## What changed because of them
- **Round 1 → 2:**
  - Plain words: "chat 46% full", "Review in terminal" (it opens the terminal and never approves anything), "I have a license key".
  - Connect says exactly what changes, plus "See exactly what changes" and Disconnect.
  - Pro became forecast + per-build usage + parallel builds + prompts, with a 14-day trial, and nothing is blocked before Pro is on sale.
  - Prompts count only when used, and the counter is visible from the start.
  - The lockout gap is spelled out ("then wait 1 h 37 min").
  - Tips have one-click fixes (Start fresh chat, Turn on undo).
  - Prompts are titled from your words, with "settle these first" questions.
  - Added `bp new`, `bp tmux` and `/bp-new`.
- **Round 2 → 3:**
  - Pause guidance with an Open button.
  - Trial-ending notice with the date, a blurred forecast teaser, readable build names, `.env` copy and package install.
  - Remove Finished Builds, plus `bp builds` / `bp done`.
  - "Use in my open Claude", a prompt box that grows to fit, and per-build $ for API users.
  - A footer theme toggle.
  - Counts got their own random id, the spool got a safety stop, and `/bp-prompt` previews before it runs.
  - An honest comparison table.
- **After round 3:**
  - Build rows wrap (the needs-you row reads "Waiting 3 min · <what it wants>").
  - "No card is on file" on the trial.
  - The forecast is labelled "Estimate from your last N min".
  - A cheaper hook safety stop.
  - `bp new --no-env`.

## What would make them pay (round-3 verdicts)
| Ask | Who | Status |
|---|---|---|
| Diff/merge review for parallel builds (finish a build from the page) | Designer, Staff engineer, Cursor user | Not built. This is the strongest Pro candidate. |
| One-click pause/queue, plus the new run-out time if paused | Indie hacker | Not built (Claude Code exposes no pause API to hooks). Today it's guidance plus an Open button. |
| Forecast accuracy history (predicted vs actual) | Indie hacker, Terminal user | Not built. Cheap to add from the existing samples. |
| Per-repo usage export (CSV) and a team/seat plan | Agency developer | Not built. |
| Annual ($79) or student price | Student, Terminal user | Stripe setup only (see PUBLISHING.md). |
| Dark by default | Staff engineer, Designer | Deliberately white by default (owner's call). One click: "Match my theme". |
| `bp go <name>` to jump to the waiting tmux pane | Terminal user | Not built. |

**Bottom line:** the free product is easy, clear and trusted by all 8 user types. Pro doesn't yet have a feature people would pay $9/mo for. The diff/merge review and a provably accurate forecast are the best bets.
