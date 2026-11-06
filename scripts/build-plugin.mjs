// Copies the self-contained CLI into the Claude Code plugin (plugin/bin/cli.js) after a build.
import * as fs from "fs";
import * as path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
fs.mkdirSync(path.join(root, "plugin/bin"), { recursive: true });
fs.copyFileSync(path.join(root, "dist/cli.js"), path.join(root, "plugin/bin/cli.js"));
console.log("plugin/bin/cli.js updated");
