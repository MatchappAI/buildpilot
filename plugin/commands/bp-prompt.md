---
description: Turn a plain-English idea into an expert Claude Code prompt (shows it first; runs only if you say so)
argument-hint: what you want, in plain words
allowed-tools: Bash(sh:*)
---

!`sh "${CLAUDE_PLUGIN_ROOT}/bin/bp.sh" prompt auto "$ARGUMENTS"`

If the output above starts with "You've used your", show it to the user as-is and stop.
Otherwise it is a structured prompt for this project. Show it to the user in a code block, then ask exactly: "Run this now? (yes / edit / no)". Do not start the work until the user says yes. If it has a "Settle these first" section and the user's request doesn't answer those questions, ask them first.
