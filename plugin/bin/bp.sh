#!/bin/sh
# BuildPilot plugin launcher: checks for Node.js first so users see one plain sentence, not a stack trace.
if ! command -v node >/dev/null 2>&1; then
  echo "BuildPilot needs Node.js 18 or newer (22.13+ recommended). Install it from https://nodejs.org, then try again."
  exit 0
fi
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
if [ -n "$major" ] && [ "$major" -lt 18 ] 2>/dev/null; then
  echo "BuildPilot needs Node.js 18 or newer (you have $(node -v)). Update it from https://nodejs.org, then try again."
  exit 0
fi
exec node "$(dirname "$0")/cli.js" "$@"
