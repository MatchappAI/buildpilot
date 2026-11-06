// Builds "BuildPilot.app": a double-click launcher that opens BuildPilot in VS Code for your most recent project.
// Usage: node scripts/make-launcher.mjs <output-dir>   (macOS only)
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(os.homedir(), "Desktop"));
const app = path.join(outDir, "BuildPilot.app");
const extId = (() => { const p = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); return `${p.publisher}.${p.name}`; })();

fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
fs.mkdirSync(path.join(app, "Contents/Resources"), { recursive: true });

fs.writeFileSync(path.join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>BuildPilot</string>
  <key>CFBundleDisplayName</key><string>BuildPilot</string>
  <key>CFBundleIdentifier</key><string>dev.buildpilot.launcher</string>
  <key>CFBundleExecutable</key><string>BuildPilot</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);

// The launcher: find Node, ask BuildPilot for your most recent project, open it in VS Code with the BuildPilot page.
fs.writeFileSync(path.join(app, "Contents/MacOS/BuildPilot"), `#!/bin/zsh
# BuildPilot launcher. Opens BuildPilot in VS Code for the project you were most recently building.
CLI="$HOME/.buildpilot/bin/cli.js"
NODE=""
for n in "$(/usr/bin/python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.buildpilot/widget-config.json"))).get("node",""))' 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node" "$HOME/.volta/bin/node" $(command -v node 2>/dev/null); do
  if [ -n "$n" ] && [ -x "$n" ]; then NODE="$n"; break; fi
done
FOLDER=""
if [ -n "$NODE" ] && [ -f "$CLI" ]; then FOLDER="$("$NODE" "$CLI" recent 2>/dev/null)"; fi
if [ -n "$FOLDER" ]; then
  ENC="$(/usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$FOLDER")"
  /usr/bin/open "vscode://${extId}/open?folder=$ENC" || /usr/bin/open -a "Visual Studio Code" "$FOLDER"
else
  /usr/bin/open -a "Visual Studio Code"
fi
`, { mode: 0o755 });

// Icon from the extension's icon.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bp-icon-"));
const set = path.join(tmp, "AppIcon.iconset");
fs.mkdirSync(set);
for (const s of [16, 32, 64, 128, 256, 512]) {
  execFileSync("sips", ["-z", String(s), String(s), path.join(root, "media/icon.png"), "--out", path.join(set, `icon_${s}x${s}.png`)], { stdio: "ignore" });
  if (s <= 256) execFileSync("sips", ["-z", String(s * 2), String(s * 2), path.join(root, "media/icon.png"), "--out", path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: "ignore" });
}
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(app, "Contents/Resources/AppIcon.icns")]);
fs.rmSync(tmp, { recursive: true, force: true });
try { execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "ignore" }); } catch { /* unsigned is fine locally */ }
try { execFileSync("touch", [app]); } catch { /* refresh Finder icon cache */ }
console.log(`Launcher ready: ${app}`);
