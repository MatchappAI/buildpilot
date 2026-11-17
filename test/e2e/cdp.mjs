// Minimal headless Chrome driver over CDP (Node 22 built-in WebSocket). Never shows a window.
// `click` = element.click() (fast, for setup); `press` = a real mouse press at the element's centre (hit-testing, overlays,
// disabled state all apply, like a person); `key` / `typeKeys` = real key events; `newTab()` = a second tab in the same browser.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const KEYS = { Enter: [13, "\r"], Tab: [9, ""], Escape: [27, ""], Backspace: [8, ""], ArrowDown: [40, ""], ArrowUp: [38, ""], " ": [32, " "] };

async function connectPage(wsUrl, proc, dir, shared) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; setTimeout(() => { if (pending.has(i)) { pending.delete(i); j(new Error(`${method}: no answer in 20 s`)); } }, 20000); pending.set(i, (d) => d.error ? j(new Error(`${method}: ${d.error.message}`)) : r(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = {
    proc, dir, events, send, ws,
    async goto(url) { await send("Page.navigate", { url }); await b.wait(() => document.readyState === "complete"); },
    async reload() { await send("Page.reload", { ignoreCache: true }); await sleep(300); await b.wait(() => document.readyState === "complete"); },
    async eval(fn, ...args) { const r = await send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; },
    async wait(fn, ms = 8000, ...args) { const t = Date.now(); for (;;) { try { if (await b.eval(fn, ...args)) return true; } catch {} if (Date.now() - t > ms) throw new Error(`timeout waiting for ${fn.toString().slice(0, 120)}`); await sleep(100); } },
    async click(sel) { const ok = await b.eval((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel); if (!ok) throw new Error(`no element ${sel}`); await sleep(150); },
    /** Centre of the first visible match, scrolled into view. */
    async box(sel) {
      const r = await b.eval((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({ block: "center", inline: "nearest" }); const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width, h: q.height }; }, sel);
      if (!r) throw new Error(`no visible element ${sel}`); return r;
    },
    /** A real mouse press: move, down, up at the element's centre. Whatever is on top there receives it. */
    async press(sel, { count = 1, gap = 40 } = {}) {
      const { x, y } = await b.box(sel);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (let n = 1; n <= count; n++) {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        if (n < count) await sleep(gap);
      }
      await sleep(150);
    },
    async hover(sel) { const { x, y } = await b.box(sel); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await sleep(100); },
    async key(k, mods = 0) { const [code, text] = KEYS[k] ?? [k.toUpperCase().charCodeAt(0), k]; const base = { key: k, windowsVirtualKeyCode: code, modifiers: mods }; await send("Input.dispatchKeyEvent", { type: text && !mods ? "keyDown" : "rawKeyDown", text: mods ? undefined : text, ...base }); await send("Input.dispatchKeyEvent", { type: "keyUp", ...base }); await sleep(40); },
    /** Types into whatever has focus, character by character (real input events). */
    async typeKeys(text) { for (const ch of text) await send("Input.insertText", { text: ch }); await sleep(50); },
    /** Fast setter for long text (fires input like a paste). */
    async type(sel, text) { await b.eval((s, t) => { const e = document.querySelector(s); e.focus(); e.value = t; e.dispatchEvent(new Event("input", { bubbles: true })); }, sel, text); },
    text: () => b.eval(() => document.body.innerText),
    focused: () => b.eval(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.dataset?.act ? `[${e.dataset.act}]` : ""}:${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 40)}` : ""; }),
    async viewport(width, height, mobile = false) { await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }); },
    /** Slow network: latency in ms on every request (and modest bandwidth). 0 = normal. */
    async throttle(latency) { await send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: latency ? 50_000 : -1, uploadThroughput: latency ? 20_000 : -1 }); },
    async offline(on) { await send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); },
    async shot(file, full = true) { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); },
    errors() { return events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") || (e.method === "Log.entryAdded" && e.params.entry.level === "error")).map((e) => JSON.stringify(e.params).slice(0, 300)); },
    clearErrors() { for (let i = events.length - 1; i >= 0; i--) if (["Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"].includes(events[i].method)) events.splice(i, 1); },
    /** A second tab in the same (headless) browser, sharing cookies. */
    async newTab(url = "about:blank") { const t = await (await fetch(`http://127.0.0.1:${shared.port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json(); const tab = await connectPage(t.webSocketDebuggerUrl, null, null, shared); tab.close = async () => { try { tab.ws.close(); } catch {} await fetch(`http://127.0.0.1:${shared.port}/json/close/${t.id}`).catch(() => {}); }; return tab; },
    async close() { try { ws.close(); } catch {} if (proc) { proc.kill("SIGTERM"); await sleep(300); fs.rmSync(dir, { recursive: true, force: true }); } },
  };
  return b;
}

export async function launch({ width = 900, height = 1100 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, "--remote-debugging-port=0", `--window-size=${width},${height}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  process.on("exit", () => { try { proc.kill("SIGKILL"); } catch {} });
  let port;
  for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {} }
  if (!port) throw new Error("chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  return connectPage(page.webSocketDebuggerUrl, proc, dir, { port });
}
