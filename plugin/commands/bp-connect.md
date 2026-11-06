---
description: Show exact memory % and plan limits in BuildPilot (turns on the status-line reporter)
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" statusline install`

Tell the user in one sentence what happened, using the output above. Mention that new or resumed sessions will now report memory % and plan limits.
