#!/bin/bash
# BuildPilot uninstaller: disconnects Claude Code (restoring your original settings and status line),
# removes the VS Code extension, and optionally moves BuildPilot's local data to the Trash.
cd "$(dirname "$0")" || exit 1
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
CLI=$(ls -1d "$EXT_DIR"/buildpilot-local.buildpilot-*/dist/cli.js 2>/dev/null | sort -V | tail -n 1)
[ -z "$CLI" ] && [ -f "$HOME/buildpilot/dist/cli.js" ] && CLI="$HOME/buildpilot/dist/cli.js"
if command -v node >/dev/null 2>&1 && [ -n "$CLI" ]; then
  node "$CLI" statusline uninstall >/dev/null && echo "✓ Status line restored to what you had before."
  node "$CLI" hooks uninstall >/dev/null && echo "✓ Disconnected from Claude Code (only BuildPilot's hooks removed)."
else
  echo "Couldn't disconnect automatically (Node.js not found)."
  echo "Please open VS Code → BuildPilot → Connect → Disconnect first, then run this again."
  pause; exit 1
fi

# 2) Remove the extension
CODE=""
for c in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$(command -v code 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && CODE="$c" && break
done
if [ -n "$CODE" ]; then
  "$CODE" "${EXT_ARGS[@]}" --uninstall-extension buildpilot-local.buildpilot 2>&1 | grep -v -E "DEP0169|trace-deprecation" | tail -n 1
  echo "✓ Extension removed (reload VS Code if it's open)."
else
  echo "VS Code not found. Remove BuildPilot from its Extensions view if needed."
fi

# 3) Local data (moved to the Trash, never deleted outright)
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
