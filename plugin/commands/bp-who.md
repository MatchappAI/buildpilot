---
description: Which Claude build changed a file, and when (so you know what broke it)
argument-hint: file name, e.g. checkout.tsx
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" who "$ARGUMENTS"`

Show the output above to the user. If they want to undo a file, offer to put it back to its last commit after confirming with them.
