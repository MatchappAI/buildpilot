#!/bin/sh
# BuildPilot plugin hook: copies the event JSON Claude Code sends on stdin into a private local spool.
# Never blocks, never prints, never sends anything anywhere. Uninstalling the plugin removes it.
d="${BUILDPILOT_HOME:-$HOME/.buildpilot}/spool"
mkdir -p "$d/tmp" 2>/dev/null || exit 0
t=$(mktemp "$d/tmp/evt.XXXXXX" 2>/dev/null) || exit 0
head -c 1048576 > "$t"
mv "$t" "$d/$(basename "$t").json" 2>/dev/null || rm -f "$t"
exit 0
