---
description: Turn a plain-English idea into an expert Claude Code prompt (BuildPilot Prompt Studio)
argument-hint: what you want, in plain words
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" prompt auto "$ARGUMENTS"`

If the output above starts with "You've used your", show it to the user as-is and stop.
Otherwise, the output is a structured prompt for this project. Briefly confirm it with the user in one sentence, then carry it out, following its "Done means" and verification steps.
