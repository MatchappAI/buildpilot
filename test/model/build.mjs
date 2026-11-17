// Builds the code under test for the model-based runs, in a throwaway folder:
//  - bin/cli.js: the real CLI (src/cli.ts), byte-for-byte the shipped bundle except that the license public key is a
//    THROWAWAY key generated here, so the runs can mint valid / expired Pro keys without the real issuer key.
//  - harness.cjs: the same engine modules for in-process runs (fast, virtual time).
//  - media/: the page files the window server serves.
import * as esbuild from "esbuild";
import crypto from "crypto"; import fs from "fs"; import path from "path"; import os from "os";
import { REPO } from "../e2e/env.mjs";

export async function buildUnderTest() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "bp-model-build."));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
  const swapKey = {
    name: "test-license-key",
    setup(b) {
      b.onLoad({ filter: /src[\\/]core[\\/]license\.ts$/ }, (a) => {
        const src = fs.readFileSync(a.path, "utf8");
        const re = /const PUBLIC_KEY = `[^`]+`;/;
        if (!re.test(src)) throw new Error("license.ts: PUBLIC_KEY constant not found");
        return { contents: src.replace(re, `const PUBLIC_KEY = ${JSON.stringify(pub)};`), loader: "ts" };
      });
    },
  };
  const version = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version;
  const common = { bundle: true, platform: "node", format: "cjs", target: "node18", logLevel: "error", plugins: [swapKey], define: { __BP_VERSION__: JSON.stringify(version) } };
  fs.mkdirSync(path.join(out, "bin"), { recursive: true });
  await esbuild.build({ ...common, entryPoints: [path.join(REPO, "src/cli.ts")], outfile: path.join(out, "bin/cli.js"), banner: { js: "#!/usr/bin/env node" } });
  await esbuild.build({ ...common, entryPoints: [path.join(REPO, "test/model/harness.ts")], outfile: path.join(out, "harness.cjs") });
  fs.copyFileSync(path.join(REPO, "node_modules/sql.js/dist/sql-wasm.wasm"), path.join(out, "bin/sql-wasm.wasm"));
  fs.copyFileSync(path.join(REPO, "node_modules/sql.js/dist/sql-wasm.wasm"), path.join(out, "sql-wasm.wasm"));
  fs.mkdirSync(path.join(out, "media"), { recursive: true });
  for (const f of ["webview.js", "webview.css", "icon.png"]) fs.copyFileSync(path.join(REPO, "media", f), path.join(out, "media", f));
  /** A Pro key signed with the throwaway key. `exp` in ms (past = expired). */
  const mint = (payload = { sub: "model@example.com", plan: "pro", exp: Date.now() + 86_400_000 }) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `BP1.${body}.${crypto.sign(null, Buffer.from(`BP1.${body}`), privateKey).toString("base64url")}`;
  };
  /** Same shape, signed with a different key (signature doesn't match). */
  const other = crypto.generateKeyPairSync("ed25519").privateKey;
  const forge = () => { const body = Buffer.from(JSON.stringify({ sub: "x", plan: "pro" })).toString("base64url"); return `BP1.${body}.${crypto.sign(null, Buffer.from(`BP1.${body}`), other).toString("base64url")}`; };
  return { dir: out, cli: path.join(out, "bin/cli.js"), harness: path.join(out, "harness.cjs"), mint, forge, cleanup: () => fs.rmSync(out, { recursive: true, force: true }) };
}
