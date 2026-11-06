---
description: Show exact chat % full and plan limits in BuildPilot (turns on the status-line reporter; your own status line keeps working)
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" statusline install`

Tell the user in one sentence what happened, using the output above. Mention that new or resumed chats will now report chat % full and plan limits.
