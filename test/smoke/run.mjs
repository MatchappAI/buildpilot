// Launches the user's installed VS Code with BuildPilot loaded in an isolated profile and runs the smoke suite.
import { runTests } from "@vscode/test-electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const candidates = [
  process.env.VSCODE_EXECUTABLE,
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
].filter(Boolean);
const exe = candidates.find((c) => fs.existsSync(c));
const ws = fs.mkdtempSync(path.join(os.tmpdir(), "bp-smoke-ws-"));
fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "smoke-app", scripts: { test: "node -e \"process.exit(0)\"" } }));
fs.mkdirSync(path.join(ws, "src"));
fs.writeFileSync(path.join(ws, "src", "index.js"), "console.log('hi')\n");
execFileSync("git", ["init", "-q"], { cwd: ws });
const home = fs.mkdtempSync(path.join(os.tmpdir(), "bp-smoke-home-"));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bp-smoke-user-"));
try {
  await runTests({
    ...(exe ? { vscodeExecutablePath: exe } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "test/smoke/suite/index.cjs"),
    launchArgs: [ws, "--disable-extensions", "--user-data-dir", userData, "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"],
    extensionTestsEnv: { BUILDPILOT_HOME: home, CLAUDE_CONFIG_DIR: path.join(home, "claude-config"), BP_SMOKE_WS: ws },
  });
  console.log("SMOKE: PASS");
} catch (e) {
  console.error("SMOKE: FAIL", e);
  process.exit(1);
}
