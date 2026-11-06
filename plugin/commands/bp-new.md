---
description: Start another Claude Code build in its own copy of this project (opens a tmux window when you use tmux)
argument-hint: short name, e.g. checkout-page
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" new "$ARGUMENTS"`

Repeat the output above to the user in one or two plain sentences (where the new build is and how to start it). Do not start working in the new folder yourself.
