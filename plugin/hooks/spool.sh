#!/bin/sh
# BuildPilot plugin hook: copies the event JSON Claude Code sends on stdin into a private local spool.
# Never blocks, never prints, never sends anything anywhere. The folder is private (owner-only) and
# BuildPilot redacts and deletes each file when it reads it. Uninstalling the plugin removes it.
d="${BUILDPILOT_HOME:-$HOME/.buildpilot}/spool"
umask 077
mkdir -p "$d/tmp" 2>/dev/null || exit 0
# First run: start the 2-day clock, so the spool stops growing if BuildPilot is never opened or was removed.
[ -e "$d/.alive" ] || : > "$d/.alive"
# Safety stop: nothing has read the spool for 2 days. One stat, no scan.
[ -n "$(find "$d/.alive" -mmin +2880 2>/dev/null)" ] && exit 0
# Hard cap: never keep more than 2000 unread events (counted by the shell itself, no extra process).
set -- "$d"/*.json
[ $# -gt 2000 ] && exit 0
t=$(mktemp "$d/tmp/evt.XXXXXX" 2>/dev/null) || exit 0
head -c 1048576 > "$t"
mv "$t" "$d/$(basename "$t").json" 2>/dev/null || rm -f "$t"
exit 0
