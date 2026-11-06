import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const watch = process.argv.includes("--watch");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.mkdirSync(path.join(root, "media"), { recursive: true });

// static assets
const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(root, to));
copy("node_modules/sql.js/dist/sql-wasm.wasm", "dist/sql-wasm.wasm");
copy("node_modules/@vscode/codicons/dist/codicon.css", "media/codicon.css");
copy("node_modules/@vscode/codicons/dist/codicon.ttf", "media/codicon.ttf");
copy("src/webview/style.css", "media/webview.css");

const common = { bundle: true, sourcemap: true, logLevel: "info", minify: !watch };
const ctxs = await Promise.all([
  esbuild.context({ ...common, entryPoints: [path.join(root, "src/extension/extension.ts")], outfile: path.join(root, "dist/extension.js"), platform: "node", format: "cjs", target: "node18", external: ["vscode"] }),
  esbuild.context({ ...common, entryPoints: [path.join(root, "src/webview/main.ts")], outfile: path.join(root, "media/webview.js"), platform: "browser", format: "iife", target: "es2020" }),
  esbuild.context({ ...common, entryPoints: [path.join(root, "src/cli.ts")], outfile: path.join(root, "dist/cli.js"), platform: "node", format: "cjs", target: "node18", banner: { js: "#!/usr/bin/env node" } }),
]);
if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
}
