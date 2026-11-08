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
t=$(mktemp "$d/tmp/evt.XXXXXX" 2>/dev/null) || exit 0
head -c 1048576 > "$t"
# Over 2000 unread events: drop tool steps, but always keep what changes a session's status
# (prompt, approval, question, finished, failed, ended). Hard stop at 5000.
set -- "$d"/*.json
if [ $# -gt 2000 ]; then
  if [ $# -gt 5000 ] || grep -Eq '"hook_event_name" *: *"(PreToolUse|PostToolUse|PostToolUseFailure|SubagentStart|SubagentStop|PreCompact|PostCompact|TaskCreated|TaskCompleted)"' "$t"; then rm -f "$t"; exit 0; fi
fi
mv "$t" "$d/$(basename "$t").json" 2>/dev/null || rm -f "$t"
exit 0
