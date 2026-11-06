#!/bin/bash
# BuildPilot installer: adds the BuildPilot Claude Code plugin, connects it, and puts BuildPilot on your Desktop.
# No VS Code needed. Safe to run again (it upgrades in place). Nothing is sent anywhere.
cd "$(dirname "$0")" || exit 1
EXT_ID="buildpilot-local.buildpilot"   # publisher.name (set from package.json by `npm run desktop`); optional VS Code part only
REPO="MatchappAI/buildpilot"
BP_HOME="${BUILDPILOT_HOME:-$HOME/.buildpilot}"
CC_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pause() { [ -z "$BP_NONINTERACTIVE" ] && { echo; read -r -p "Press Return to close this window." _; }; }
yes() { [ "$1" = "y" ] || [ "$1" = "Y" ]; }

say "BuildPilot installer"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code isn't installed. Install it first (https://claude.com/claude-code), then run this again."
  pause; exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. BuildPilot's window and 'bp' command need it: https://nodejs.org (LTS). Then run this again."
  pause; exit 1
fi

# 1) The Claude Code plugin (brings its own hooks, /bp commands and the bp tool)
echo "Adding the BuildPilot plugin to Claude Code…"
claude plugin marketplace add "$REPO" >/dev/null 2>&1 || claude plugin marketplace update buildpilot >/dev/null 2>&1
if claude plugin install buildpilot@buildpilot 2>&1 | tail -n 1 | grep -qiE "success|already"; then echo "✓ Plugin installed."; else echo "✓ Plugin is installed (or was already)."; fi
PLUG=$(ls -1d "$CC_HOME"/plugins/cache/buildpilot/buildpilot/*/ 2>/dev/null | sort -V | tail -n 1)
[ -z "$PLUG" ] && PLUG="$CC_HOME/plugins/marketplaces/buildpilot/plugin/"
if [ ! -f "$PLUG/bin/cli.js" ]; then echo "Couldn't find the plugin files. In Claude Code run: /plugin install buildpilot@buildpilot"; pause; exit 1; fi

# 2) A stable copy of the bp tool + page files (used by the Desktop app, the terminal and the menu bar)
mkdir -p "$BP_HOME/bin" "$BP_HOME/media/widget"
cp "$PLUG/bin/cli.js" "$BP_HOME/bin/cli.js"
cp -R "$PLUG/media/." "$BP_HOME/media/"
CLI="$BP_HOME/bin/cli.js"
echo "✓ BuildPilot tools ready."

# 3) Exact chat % and plan limits (Claude Code's status line; any status line you have keeps working)
if [ -n "$BP_NONINTERACTIVE" ]; then ans="${BP_CONNECT:-n}"; else
  say "Show exact chat % and plan limits?"
  echo "Adds a small status-line reporter to $CC_HOME/settings.json (backed up first; your own status line keeps showing)."
  read -r -p "Turn on? (y/n) " ans
fi
if yes "$ans"; then node "$CLI" statusline install >/dev/null && echo "✓ Turned on."; else echo "Skipped. Turn on later with: bp statusline install"; fi

# 4) Optional: summary in every terminal + bp command
if [ -n "$BP_NONINTERACTIVE" ]; then sh_ans="${BP_SHELL:-n}"; else
  say "Show BuildPilot when you open a terminal, and add the 'bp' command?"
  echo "Adds 3 lines to ~/.zshrc (backed up first). Silence anytime with: export BUILDPILOT_QUIET=1"
  read -r -p "Turn on? (y/n) " sh_ans
fi
yes "$sh_ans" && node "$CLI" shell install >/dev/null && echo "✓ Type 'bp' in a new terminal."

# 5) Optional: menu-bar icon (macOS)
if [ "$(uname)" = "Darwin" ]; then
  if [ -n "$BP_NONINTERACTIVE" ]; then bar_ans="${BP_BAR:-n}"; else
    say "Add BuildPilot to your menu bar?"
    echo "A small icon at the top of your screen: your builds, what needs you, plan limits, and a notification when Claude is waiting."
    read -r -p "Add it? (y/n) " bar_ans
  fi
  yes "$bar_ans" && node "$CLI" bar install >/dev/null && echo "✓ BuildPilot is in your menu bar (top right)."
fi

# 6) The BuildPilot app on your Desktop
if [ -d "BuildPilot.app" ] && [ "$(uname)" = "Darwin" ]; then
  rm -rf "$HOME/Desktop/BuildPilot.app" && cp -R "BuildPilot.app" "$HOME/Desktop/BuildPilot.app" && echo "✓ BuildPilot app is on your Desktop."
fi

# 7) Optional: also inside VS Code / Cursor
VSIX=$(ls -1 BuildPilot*.vsix 2>/dev/null | sort -V | tail -n 1)
CODE=""
for c in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" "$(command -v code 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && CODE="$c" && break
done
if [ -n "$CODE" ] && [ -n "$VSIX" ] && [ -z "$BP_NONINTERACTIVE" ]; then
  say "Optional: also show BuildPilot inside your code editor?"
  read -r -p "Add to $(basename "$CODE")? (y/n) " vs_ans
  yes "$vs_ans" && "$CODE" --install-extension "$VSIX" --force 2>&1 | grep -v -E "DEP0169|trace-deprecation" | tail -n 1
fi

say "Done. Opening BuildPilot…"
[ -z "$BP_NONINTERACTIVE" ] && node "$CLI" ui "$(node "$CLI" recent 2>/dev/null)" >/dev/null 2>&1
echo "Next time: double-click BuildPilot on your Desktop, type 'bp ui', or '/bp-ui' in Claude Code."
echo "Read '1 - START HERE.pdf' in this folder for the full guide."
pause
