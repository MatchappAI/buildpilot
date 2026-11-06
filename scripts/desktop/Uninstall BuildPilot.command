#!/bin/bash
# BuildPilot uninstaller: disconnects Claude Code (restoring your original settings and status line),
# removes the Claude Code plugin, the Desktop app and the optional VS Code extension, and optionally moves
# BuildPilot's local data to the Trash.
cd "$(dirname "$0")" || exit 1
EXT_ID="buildpilot-local.buildpilot"   # publisher.name (set from package.json by `npm run desktop`)
BP_HOME="${BUILDPILOT_HOME:-$HOME/.buildpilot}"
EXT_ARGS=()
[ -n "$BP_TEST_EXT_DIR" ] && EXT_ARGS=(--extensions-dir "$BP_TEST_EXT_DIR")
EXT_DIR="${BP_TEST_EXT_DIR:-$HOME/.vscode/extensions}"
TRASH="${BP_TEST_TRASH:-$HOME/.Trash}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pause() { [ -z "$BP_NONINTERACTIVE" ] && { echo; read -r -p "Press Return to close this window." _; }; }

say "BuildPilot uninstaller"
if [ -z "$BP_NONINTERACTIVE" ]; then
  read -r -p "Remove BuildPilot from this Mac? (y/n) " go
  [ "$go" = "y" ] || [ "$go" = "Y" ] || { echo "Nothing changed."; pause; exit 0; }
fi

# 1) Disconnect Claude Code FIRST (needs the extension's CLI), so your status line is restored before files go away.
CLI=$(ls -1d "$EXT_DIR"/$EXT_ID-*/dist/cli.js 2>/dev/null | sort -V | tail -n 1)
[ -z "$CLI" ] && [ -f "$BP_HOME/bin/cli.js" ] && CLI="$BP_HOME/bin/cli.js"
[ -z "$CLI" ] && [ -f "$HOME/buildpilot/dist/cli.js" ] && CLI="$HOME/buildpilot/dist/cli.js"
if command -v node >/dev/null 2>&1 && [ -n "$CLI" ]; then
  node "$CLI" statusline uninstall >/dev/null && echo "✓ Status line restored to what you had before."
  node "$CLI" hooks uninstall >/dev/null && echo "✓ Disconnected from Claude Code (only BuildPilot's hooks removed)."
  node "$CLI" shell uninstall >/dev/null && echo "✓ Removed from terminal startup (~/.zshrc restored)."
  node "$CLI" bar uninstall >/dev/null 2>&1 && echo "✓ Menu-bar widget removed (if it was installed)."
else
  echo "Couldn't disconnect automatically (Node.js not found)."
  echo "Install Node.js (https://nodejs.org) or open BuildPilot and click Disconnect, then run this again."
  pause; exit 1
fi

# 2) Remove the Claude Code plugin and the Desktop app
if command -v claude >/dev/null 2>&1; then
  claude plugin uninstall buildpilot@buildpilot >/dev/null 2>&1 && echo "✓ Claude Code plugin removed."
  claude plugin marketplace remove buildpilot >/dev/null 2>&1
fi
[ -d "$HOME/Desktop/BuildPilot.app" ] && mkdir -p "$TRASH" && mv "$HOME/Desktop/BuildPilot.app" "$TRASH/BuildPilot.app $(date +%H%M%S)" && echo "✓ Desktop app moved to the Trash."
[ -f "$BP_HOME/ui-server.json" ] && kill "$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pid"])' "$BP_HOME/ui-server.json" 2>/dev/null)" 2>/dev/null

# 3) Remove the optional VS Code extension
CODE=""
for c in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$(command -v code 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && CODE="$c" && break
done
# Only if BuildPilot is actually installed in THIS user's extensions folder (never touch another setup).
if [ -n "$CODE" ] && ls -d "$EXT_DIR"/$EXT_ID-* >/dev/null 2>&1; then
  "$CODE" "${EXT_ARGS[@]}" --uninstall-extension "$EXT_ID" 2>&1 | grep -v -E "DEP0169|trace-deprecation" | tail -n 1
  echo "✓ VS Code extension removed (if it was installed)."
else
  : # no VS Code: nothing to remove
fi

# 4) Local data (moved to the Trash, never deleted outright)
if [ -d "$BP_HOME" ]; then
  if [ -n "$BP_NONINTERACTIVE" ]; then keep="${BP_TRASH_DATA:-n}"; else
    say "Move BuildPilot's data to the Trash?"
    echo "($BP_HOME: session history, notes, settings backups, screenshots. Your projects are not touched.)"
    read -r -p "Move to Trash? (y/n) " keep
  fi
  if [ "$keep" = "y" ] || [ "$keep" = "Y" ]; then
    mkdir -p "$TRASH" && mv "$BP_HOME" "$TRASH/BuildPilot data $(date +%Y-%m-%d_%H%M%S)" && echo "✓ Data moved to the Trash."
  else
    echo "Data kept in $BP_HOME."
  fi
fi

say "BuildPilot is uninstalled."
pause
