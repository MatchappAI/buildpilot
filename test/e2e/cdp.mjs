// Minimal headless Chrome driver over CDP (Node 22 built-in WebSocket). Never shows a window.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export async function launch({ width = 900, height = 1100 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, "--remote-debugging-port=0", `--window-size=${width},${height}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  process.on("exit", () => { try { proc.kill("SIGKILL"); } catch {} });
  let port;
  for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {} }
  if (!port) throw new Error("chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; setTimeout(() => { if (pending.has(i)) { pending.delete(i); j(new Error(`${method}: no answer in 20 s`)); } }, 20000); pending.set(i, (d) => d.error ? j(new Error(`${method}: ${d.error.message}`)) : r(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  const b = {
    proc, dir, events, send,
    async goto(url) { await send("Page.navigate", { url }); await b.wait(() => document.readyState === "complete"); },
    async eval(fn, ...args) { const r = await send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; },
    async wait(fn, ms = 8000, ...args) { const t = Date.now(); for (;;) { try { if (await b.eval(fn, ...args)) return true; } catch {} if (Date.now() - t > ms) throw new Error(`timeout waiting for ${fn.toString().slice(0, 120)}`); await new Promise((r) => setTimeout(r, 100)); } },
    async click(sel) { const ok = await b.eval((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel); if (!ok) throw new Error(`no element ${sel}`); await new Promise((r) => setTimeout(r, 150)); },
    async type(sel, text) { await b.eval((s, t) => { const e = document.querySelector(s); e.focus(); e.value = t; e.dispatchEvent(new Event("input", { bubbles: true })); }, sel, text); },
    text: () => b.eval(() => document.body.innerText),
    async viewport(width, height) { await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); },
    async shot(file) { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); },
    errors() { return events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") || (e.method === "Log.entryAdded" && e.params.entry.level === "error")).map((e) => JSON.stringify(e.params).slice(0, 300)); },
    async close() { try { ws.close(); } catch {} proc.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  return b;
}
