// Assembles the user-facing Desktop folder (~/Desktop/BuildPilot) from the packaged VSIX, the guide PDF and the
// install/uninstall scripts. Run via `npm run desktop` (which packages and prints the guide first).
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const extId = `${pkg.publisher}.${pkg.name}`;
const out = process.env.BP_DESKTOP_DIR ?? path.join(os.homedir(), "Desktop", "BuildPilot");
fs.mkdirSync(out, { recursive: true });

for (const f of fs.readdirSync(out)) if (/^BuildPilot.*\.vsix$/.test(f)) fs.rmSync(path.join(out, f));
fs.copyFileSync(path.join(root, "dist/START-HERE.pdf"), path.join(out, "1 - START HERE.pdf"));
for (const [src, dest] of [["Install BuildPilot.command", "2 - Install BuildPilot.command"], ["Uninstall BuildPilot.command", "3 - Uninstall BuildPilot.command"]]) {
  const text = fs.readFileSync(path.join(root, "scripts/desktop", src), "utf8").replace(/^EXT_ID="[^"]*"/m, `EXT_ID="${extId}"`);
  fs.writeFileSync(path.join(out, dest), text, { mode: 0o755 });
}
fs.copyFileSync(path.join(root, "dist/buildpilot.vsix"), path.join(out, `BuildPilot ${pkg.version}.vsix`));
console.log(`Desktop folder ready: ${out} (${extId} ${pkg.version})`);

// macOS: a double-click launcher (opens BuildPilot in VS Code for your most recent project).
if (process.platform === "darwin") {
  const { execFileSync } = await import("child_process");
  execFileSync(process.execPath, [path.join(root, "scripts/make-launcher.mjs"), out], { stdio: "inherit" });
}
