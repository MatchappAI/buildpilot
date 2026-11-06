// Copies the self-contained CLI and the page files into the Claude Code plugin after a build.
import * as fs from "fs";
import * as path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
fs.mkdirSync(path.join(root, "plugin/bin"), { recursive: true });
fs.copyFileSync(path.join(root, "dist/cli.js"), path.join(root, "plugin/bin/cli.js"));
fs.mkdirSync(path.join(root, "plugin/media/widget"), { recursive: true });
for (const f of ["webview.js", "webview.css", "icon.png", "widget/BuildPilot-Bar.zip"]) if (fs.existsSync(path.join(root, "media", f))) fs.copyFileSync(path.join(root, "media", f), path.join(root, "plugin/media", f));
console.log("plugin/bin/cli.js + plugin/media updated");
