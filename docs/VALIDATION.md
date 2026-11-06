# Proving it with real users

Simulated reviews ([PERSONA_REVIEW.md](PERSONA_REVIEW.md)) find friction. They can't prove demand. Only real users can. Run a 30–50 person beta and judge it on these numbers.

| Signal | How it's measured | Target | Kill / rethink if |
|---|---|---|---|
| Activation: connected within 2 minutes of install | opt-in counts `installed` → `connected` | ≥ 60% | < 35% |
| Retention: still using after 7 days | `day7` ÷ `connected` | ≥ 30% | < 15% |
| Conversion: free → paid after the 14-day trial | `upgraded` ÷ `day7`, plus Stripe | 3–5% | < 1% |
| "How would you feel if you could no longer use BuildPilot?" (Sean Ellis test, asked once in week 2) | 1-question form | ≥ 40% "very disappointed" | < 20% |
| Top reason to pay (open text) | same form | Points at one feature | Scattered |

## Steps
1. Finish the "needs you" steps in [PUBLISHING.md](PUBLISHING.md): the Stripe link, the Worker and the count URL.
2. Recruit from where Claude Code users already are: r/ClaudeAI, Claude Code GitHub discussions, X/Bluesky, indie hacker communities, and friends who build with AI. Aim for a mix that matches the 8 personas.
3. Watch 5 of them install it live on a call, without helping. Note every pause. This beats any survey.
4. After 2 weeks, compare against the table and pick the next Pro feature. Current favourite: diff/merge review for parallel builds.

The counts are opt-in, so expect only some users to share them. Treat the counts as a floor and the interviews as the truth.
