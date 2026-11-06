#!/bin/bash
# BuildPilot installer: installs the VS Code extension from this folder and (optionally) connects Claude Code.
# Safe to run again (it upgrades in place). Nothing is sent anywhere.
cd "$(dirname "$0")" || exit 1
BP_HOME="${BUILDPILOT_HOME:-$HOME/.buildpilot}"
EXT_ARGS=()
[ -n "$BP_TEST_EXT_DIR" ] && EXT_ARGS=(--extensions-dir "$BP_TEST_EXT_DIR")
EXT_DIR="${BP_TEST_EXT_DIR:-$HOME/.vscode/extensions}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pause() { [ -z "$BP_NONINTERACTIVE" ] && { echo; read -r -p "Press Return to close this window." _; }; }

say "BuildPilot installer"

CODE=""
for c in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$(command -v code 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && CODE="$c" && break
done
if [ -z "$CODE" ]; then
  echo "Visual Studio Code wasn't found. Install it from https://code.visualstudio.com, then run this again."
  pause; exit 1
fi

VSIX=$(ls -1 BuildPilot*.vsix 2>/dev/null | sort -V | tail -n 1)
if [ -z "$VSIX" ]; then
  echo "The BuildPilot .vsix file isn't in this folder. Keep this script next to it."
  pause; exit 1
fi

echo "Installing $VSIX into VS Code…"
if ! "$CODE" "${EXT_ARGS[@]}" --install-extension "$VSIX" --force 2>&1 | grep -v -E "DEP0169|trace-deprecation"; then
  echo "Installation failed. Try in VS Code: Command Palette → 'Extensions: Install from VSIX…'."
  pause; exit 1
fi
echo "✓ Extension installed."

CLI=$(ls -1d "$EXT_DIR"/buildpilot-local.buildpilot-*/dist/cli.js 2>/dev/null | sort -V | tail -n 1)
if ! command -v claude >/dev/null 2>&1; then
  echo "Note: Claude Code isn't installed yet (https://claude.com/claude-code). BuildPilot still analyzes projects without it."
fi
if command -v node >/dev/null 2>&1 && [ -n "$CLI" ]; then
  if [ -n "$BP_NONINTERACTIVE" ]; then ans="${BP_CONNECT:-n}"; else
    say "Connect BuildPilot to Claude Code now?"
    echo "This adds background hooks (and an exact context-% status line) to ~/.claude/settings.json."
    echo "Your existing settings are kept and backed up first. Nothing leaves your computer. Fully reversible."
    read -r -p "Connect? (y/n) " ans
  fi
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    node "$CLI" hooks install >/dev/null && echo "✓ Connected to Claude Code."
    node "$CLI" statusline install >/dev/null && echo "✓ Exact context % turned on (any status line you had keeps showing)."
  else
    echo "Skipped. You can click Connect inside BuildPilot anytime."
  fi
else
  echo "To connect Claude Code: open BuildPilot in VS Code and click Connect."
fi

say "Done!"
echo "1. Open VS Code (if it was open: Cmd+Shift+P → 'Reload Window')."
echo "2. Open a project folder and click the BuildPilot compass icon on the left."
echo "3. Read '1 - START HERE.pdf' in this folder for the full guide."
pause
