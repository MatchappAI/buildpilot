---
description: Review a side build's changes and merge it into your project (aborts safely on conflicts)
argument-hint: build name, e.g. checkout
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" review "$ARGUMENTS"`

Show the user the list above in a code block and ask: "Merge these changes into your project? (yes / no)". Only if they say yes, run `node "${CLAUDE_PLUGIN_ROOT}/bin/cli.js" merge "$ARGUMENTS"` and report the result in one or two plain sentences. If it reports conflicts, offer to resolve them inside that build's folder.
