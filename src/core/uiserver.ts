import { execFile } from "child_process";
import { randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { claudeSettingsPath, connectPreview, installHooks, installStatusline, pluginConnected, uninstallHooks, uninstallStatusline } from "./hooks";
import type { Engine } from "./engine";
import { pageData } from "./page";
import { checkoutUrl, gate, gateParallel, plan, readUsage, recordUse, saveLicense } from "./license";
import { worktrees, run } from "./git";
import { GoalType } from "./types";
import { shellQuote } from "./prompts";
import { findBuild } from "./termfind";
import { setBuildName } from "./glance";
import { alertsFor, AlertMemory, claimAlert } from "./alerts";

/**
 * BuildPilot as its own app (no VS Code): a private local web server that serves the same one-page UI.
 * - Listens on 127.0.0.1 only; every request needs a random token (in the URL the launcher opens) and a
 *   localhost Host header, so other websites can't drive it (CSRF / DNS-rebinding safe).
 * - Side effects (Connect, merge, new build, …) are confirmed in the page before they're sent.
 * - Terminals open in the user's Terminal app (macOS), never by building shell strings from untrusted input:
 *   folders and prompt files are passed as AppleScript arguments and shell-quoted.
 */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface UiServerOptions { port?: number; token?: string; media: string; idleExitMs?: number }

const MIME: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".ttf": "font/ttf" };

/** Open a terminal window in `dir` and run a fixed command there.
 * macOS: Terminal.app · Windows: Windows Terminal, else a cmd window · Linux: the first terminal found. */
export function openTerminal(dir: string, command: string | null): Promise<void> {
  const line = `cd ${shellQuote(dir)}${command ? ` && ${command}` : ""}`;
  const manual = () => new Error(`Open a terminal in ${dir} and run: ${command ?? "claude"}`);
  const tryEach = (cands: [string, string[]][], i = 0): Promise<void> =>
    i >= cands.length
      ? Promise.reject(manual())
      : new Promise((resolve, reject) => {
          const [bin, args] = cands[i]!;
          execFile(bin, args, { timeout: 15000, windowsHide: false }, (e) => (e && (e as NodeJS.ErrnoException).code === "ENOENT" ? tryEach(cands, i + 1).then(resolve, reject) : e ? reject(e) : resolve()));
        });
  if (process.platform === "darwin") {
    return new Promise((resolve, reject) =>
      execFile("osascript", ["-e", "on run argv", "-e", 'tell application "Terminal" to do script (item 1 of argv)', "-e", 'tell application "Terminal" to activate', "-e", "end run", line], { timeout: 15000 }, (e) => (e ? reject(e) : resolve())),
    );
  }
  if (process.platform === "win32") {
    // Commands come from BuildPilot itself (claude …), never from untrusted input; the folder is passed as its own argument.
    const cmd = command ?? "claude";
    return tryEach([
      ["wt.exe", ["-d", dir, "cmd", "/k", cmd]],
      ["cmd.exe", ["/c", "start", "", "/d", dir, "cmd", "/k", cmd]],
    ]);
  }
  const sh = `${line}; exec "\${SHELL:-sh}"`;
  return tryEach([
    ["x-terminal-emulator", ["-e", "sh", "-c", sh]],
    ["gnome-terminal", ["--", "sh", "-c", sh]],
    ["konsole", ["-e", "sh", "-c", sh]],
    ["xfce4-terminal", ["-x", "sh", "-c", sh]],
    ["kitty", ["sh", "-c", sh]],
    ["alacritty", ["-e", "sh", "-c", sh]],
    ["xterm", ["-e", "sh", "-c", sh]],
  ]);
}

export function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
    const args = process.platform === "linux" ? ["-selection", "clipboard"] : [];
    const p = execFile(cmd, args, (e) => (e ? reject(e) : resolve()));
    p.stdin?.end(text);
  });
}

/** macOS notification; title/body passed as AppleScript arguments (never interpolated). */
export function notify(title: string, body: string): void {
  if (process.platform !== "darwin") return;
  execFile("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title.slice(0, 80), body.slice(0, 200)], { timeout: 5000 }, () => {});
}

const openUrl = (u: string) => execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [u], () => {});

export class UiServer {
  readonly token: string;
  private server: http.Server | null = null;
  private lastSeen = Date.now();
  private idle: NodeJS.Timeout | null = null;
  private side: unknown[] = [];
  private alertTimer: NodeJS.Timeout | null = null;
  private memory: AlertMemory = { sent: {} };

  constructor(private engine: Engine, private opts: UiServerOptions) {
    this.token = opts.token ?? randomBytes(16).toString("hex");
  }

  private launchCodes = new Map<string, number>();

  get port(): number | undefined {
    const a = this.server?.address();
    return a && typeof a === "object" ? a.port : this.opts.port;
  }

  /** Address with a one-time launch code (valid 2 minutes, single use). Safe to pass on a command line or keep in history. */
  get url(): string {
    return `http://127.0.0.1:${this.port}/?c=${this.issueLaunchCode()}`;
  }

  issueLaunchCode(): string {
    const now = Date.now();
    for (const [c, exp] of this.launchCodes) if (exp < now) this.launchCodes.delete(c);
    const code = randomBytes(12).toString("hex");
    this.launchCodes.set(code, now + 2 * 60_000);
    return code;
  }

  private get cookieName(): string {
    return `bp_${this.port}`;
  }

  /** Header (page scripts, CLI) or the session cookie set after a launch code. The long-lived token never goes in a URL. */
  private authed(req: http.IncomingMessage): boolean {
    const h = req.headers["x-bp-token"];
    if (typeof h === "string" && safeEqual(h, this.token)) return true;
    const cookie = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${this.cookieName}=`));
    return !!cookie && safeEqual(cookie.slice(this.cookieName.length + 1), this.token);
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.opts.port ?? 0, "127.0.0.1", () => resolve());
    });
    // macOS notifications so you don't miss "Claude needs you", limits, error bursts or compaction.
    this.alertTimer = setInterval(() => void this.checkAlerts(), 15_000);
    void this.checkAlerts();
    if (this.opts.idleExitMs) this.idle = setInterval(() => { if (Date.now() - this.lastSeen > this.opts.idleExitMs!) void this.stop().then(() => process.exit(0)); }, 30_000);
    void this.refreshSide();
  }

  private uiPrefs(): { theme?: string; alerts?: boolean } {
    try { return JSON.parse(fs.readFileSync(path.join(this.engine.home, "ui.json"), "utf8")) as { theme?: string; alerts?: boolean }; } catch { return {}; }
  }

  private savePrefs(p: { theme?: string; alerts?: boolean }): void {
    fs.writeFileSync(path.join(this.engine.home, "ui.json"), JSON.stringify({ ...this.uiPrefs(), ...p }));
  }

  async checkAlerts(): Promise<void> {
    if (this.uiPrefs().alerts === false || process.platform !== "darwin") return;
    try {
      const pd = pageData(this.engine, this.engine.snapshot());
      for (const a of alertsFor(pd, this.memory, Date.now())) if (claimAlert(this.engine.home, a.key)) notify(a.title, a.body);
    } catch {
      /* never let alerts break the window */
    }
  }

  async stop(): Promise<void> {
    if (this.alertTimer) clearInterval(this.alertTimer);
    if (this.idle) clearInterval(this.idle);
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }

  private async refreshSide(): Promise<void> {
    try {
      const out = [];
      for (const b of await this.engine.extraBuilds()) {
        const c = await this.engine.buildChanges(b.dir, b.branch);
        out.push({ name: path.basename(b.dir), dir: b.dir, branch: b.branch, changed: c.files.length, unsaved: c.unsaved, commits: c.commits });
      }
      this.side = out;
    } catch {
      /* not a git project */
    }
  }

  private statePayload() {
    const st = this.engine.snapshot();
    return { type: "state", state: st, page: { ...pageData(this.engine, st), side: this.side }, settings: { trusted: true, theme: this.theme(), standalone: true, alerts: this.uiPrefs().alerts !== false } };
  }

  private theme(): string {
    const t = this.uiPrefs().theme;
    return t === "match" || t === "white" ? t : "auto"; // no saved choice: the page follows the system light/dark setting
  }

  private send(res: http.ServerResponse, code: number, body: unknown, type = "application/json; charset=utf-8"): void {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const host = (req.headers.host ?? "").split(":")[0];
      if (host !== "127.0.0.1" && host !== "localhost") return this.send(res, 403, { error: "forbidden" });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/media/")) {
        const f = path.join(this.opts.media, path.basename(url.pathname));
        if (!fs.existsSync(f)) return this.send(res, 404, "not found", "text/plain");
        return this.send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] ?? "application/octet-stream");
      }
      const code = url.searchParams.get("c");
      if (req.method === "GET" && url.pathname === "/" && code) {
        const exp = this.launchCodes.get(code);
        this.launchCodes.delete(code); // single use, valid or not
        if (!exp || exp < Date.now()) return this.send(res, 401, "This BuildPilot link has expired. Run bp ui again.", "text/plain; charset=utf-8");
        res.writeHead(302, { location: "/", "set-cookie": `${this.cookieName}=${this.token}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store" });
        return void res.end();
      }
      if (!this.authed(req)) return this.send(res, 401, { error: "missing or wrong token" });
      if (req.method === "POST" && url.pathname === "/api/launch") return this.send(res, 200, { code: this.issueLaunchCode() });
      this.lastSeen = Date.now();
      if (req.method === "GET" && url.pathname === "/") return this.send(res, 200, this.html(), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/state") return this.send(res, 200, this.statePayload());
      if (req.method === "POST" && url.pathname === "/api/msg") {
        let body = "";
        for await (const c of req) { body += c; if (body.length > 300_000) return this.send(res, 413, { error: "too large" }); }
        const m = JSON.parse(body || "{}") as Record<string, unknown>;
        const result = await this.onMessage(m);
        return this.send(res, 200, { result: result ?? null });
      }
      return this.send(res, 404, { error: "not found" });
    } catch (e) {
      return this.send(res, 500, { error: (e as Error).message });
    }
  }

  // ---- the page is trusted to ask, not to name arbitrary paths: every folder/file must be one BuildPilot already knows ----

  /** A folder some Claude session worked in (optionally that exact session), or the current project. */
  private knownFolder(dir: string, sessionId?: string): boolean {
    if (!dir) return false;
    const abs = path.resolve(dir);
    if (this.engine.currentProject && path.resolve(this.engine.currentProject.root) === abs) return true;
    return sessionId
      ? !!this.engine.store.get("SELECT 1 AS x FROM sessions WHERE id = ? AND cwd = ?", [sessionId, abs])
      : !!this.engine.store.get("SELECT 1 AS x FROM sessions WHERE cwd = ? LIMIT 1", [abs]);
  }

  /** A file a Claude session edited (the "who changed this file" list). */
  private knownEditedFile(file: string): boolean {
    // Only files a session EDITED (Read/Grep events also carry a file path).
    return !!file && !!this.engine.store.get("SELECT 1 AS x FROM events WHERE file_path = ? AND hook_event = 'PostToolUse' AND tool_name IN ('Edit','Write','MultiEdit','NotebookEdit') LIMIT 1", [path.resolve(file)]);
  }

  /** One of the current project's side builds (git worktrees made by + New build). */
  private async knownBuild(dir: string): Promise<boolean> {
    if (!dir) return false;
    const abs = path.resolve(dir);
    return (await this.engine.extraBuilds()).some((b) => path.resolve(b.dir) === abs);
  }

  /** The same messages the VS Code extension handles, implemented without VS Code. Confirmation happens in the page. */
  async onMessage(m: Record<string, unknown>): Promise<unknown> {
    const eng = this.engine;
    const root = eng.currentProject?.root ?? null;
    const str = (k: string) => String(m[k] ?? "");
    switch (m.type) {
      case "ready": return null;
      case "buildPrompt": return eng.gatedPrompt({ goal: str("goal") as GoalType, request: str("request"), beginner: true, planFirst: m.planFirst !== false }, undefined, !m.defer);
      case "promptUsed": return recordUse(eng.home);
      case "copy": case "useInOpen": await copyText(str("text")); return { flash: m.type === "useInOpen" ? "Copied. Paste it into Claude (Cmd+V)" : "Copied" };
      case "sendToClaude": {
        if (!root) return { flash: "Pick a project first" };
        const dir = path.join(eng.home, "prompts");
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, `prompt-${Date.now()}.md`);
        fs.writeFileSync(file, str("text"), { mode: 0o600 });
        if (process.platform === "win32") {
          // cmd has no safe "$(cat file)": copy the prompt and start Claude; the user pastes it.
          await copyText(str("text"));
          await openTerminal(root, "claude");
          return { flash: "Claude is starting. Your prompt is copied: paste it (Ctrl+V)" };
        }
        await openTerminal(root, `claude "$(cat ${shellQuote(file)})"`);
        return { flash: "Claude is starting in Terminal" };
      }
      case "openBuild": {
        if (!this.knownFolder(str("cwd"))) return { flash: "BuildPilot doesn't know that folder" };
        const r = await findBuild(str("cwd"));
        return r.found ? { flash: `Switched to it in ${r.how}` } : { show: `${r.how}\n\nSwitch to that window to see what Claude is asking.` };
      }
      case "renameBuild": {
        const id = str("id");
        if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
        setBuildName(eng, id, str("name"));
        return { flash: str("name").trim() ? "Renamed" : "Name cleared" };
      }
      case "hideIdle": return { flash: `Hid ${eng.hideIdle()} idle build(s). Their history is kept.` };
      case "whoChanged": {
        const rows = eng.fileHistory(str("query"));
        return { files: rows.map((r) => ({ ...r, file: path.basename(r.path) })) };
      }
      case "undoFile": {
        try {
          if (!this.knownEditedFile(str("path"))) return { flash: "BuildPilot only puts back files a Claude session changed" };
          const r = await eng.undoFile(str("path"));
          return { flash: `Put back the last saved version. (Safety save point ${r.safety.slice(0, 8)} has the version you just replaced.)` };
        } catch (e) {
          return { show: (e as Error).message };
        }
      }
      case "toggleAlerts": { this.savePrefs({ alerts: this.uiPrefs().alerts === false }); return { flash: this.uiPrefs().alerts === false ? "Alerts off" : "Alerts on" }; }
      case "resumeBuild": {
        const id = str("id");
        const cwd = str("cwd");
        if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !fs.existsSync(cwd) || !this.knownFolder(cwd, id)) return { flash: "Can't resume that one" };
        await openTerminal(cwd, `claude --resume ${id}`);
        return { flash: "Resuming in Terminal" };
      }
      case "startFresh": {
        const cwd = str("cwd") || root;
        if (!cwd || !fs.existsSync(cwd) || !this.knownFolder(cwd)) return null;
        await copyText(eng.handoff());
        await openTerminal(cwd, "claude");
        return { flash: "Summary copied. Paste it into the new Claude (Cmd+V)" };
      }
      case "copyHandoff": await copyText(eng.handoff()); return { flash: "Handoff copied" };
      case "connectAll": {
        const file = claudeSettingsPath("user");
        if (!pluginConnected(file)) installHooks(file, eng.home); // the plugin already brings its own hooks
        installStatusline(file, eng.home);
        eng.setClaudeSettingsFile(file);
        return { flash: "Connected. Builds appear as soon as Claude does something" };
      }
      case "showConnectChanges": return { show: connectPreview(eng.home) };
      case "disconnect": {
        uninstallHooks(claudeSettingsPath("user"), eng.home);
        if (root) { const pf = claudeSettingsPath("project", root); if (fs.existsSync(pf)) uninstallHooks(pf, eng.home); }
        uninstallStatusline(claudeSettingsPath("user"), eng.home);
        return { flash: "Disconnected. Your Claude Code settings are back to how they were" };
      }
      case "fixDoubleHooks": {
        const file = claudeSettingsPath("user");
        if (!pluginConnected(file)) return { flash: "The plugin isn't on, so the hooks were kept" };
        uninstallHooks(file); // only BuildPilot's own hook lines; the status line and everything else stay
        return { flash: "Done. BuildPilot now counts each step once" };
      }
      case "setupUndo": {
        if (!root) return null;
        const steps: string[][] = [];
        if (!fs.existsSync(path.join(root, ".git"))) steps.push(["init", "-q"]);
        steps.push(["add", "-A"], ["-c", "user.name=BuildPilot", "-c", "user.email=buildpilot@localhost", "commit", "-q", "--allow-empty", "-m", "First save point (BuildPilot)"]);
        for (const a of steps) { const r = await run("git", a, root, { timeoutMs: 60_000 }); if (r.code !== 0) return { flash: `Couldn't turn on undo: ${r.stderr.trim()}` }; }
        await eng.analyze();
        return { flash: "Undo is on. First save point made" };
      }
      case "checkpoint": {
        const cp = await eng.checkpoint("save point");
        return { flash: `Save point made (${cp.sha.slice(0, 8)})` };
      }
      case "newBuild": {
        if (!root) return { flash: "Pick a project first" };
        const extra = Math.max(0, (await worktrees(root)).length - 1);
        const g = gateParallel(eng.home, extra);
        if (!g.allowed) return { paywall: g.paywall.message, url: g.paywall.url };
        const head = await run("git", ["rev-parse", "--verify", "-q", "HEAD"], root);
        if (head.code !== 0) return { flash: "A new build needs undo (Git) first: use “Turn on undo”" };
        const w = await eng.createWorktree(str("label") || "build");
        const install = fs.existsSync(path.join(w.dir, "package.json")) ? `${eng.snapshot().facts?.packageManager === "pnpm" ? "pnpm" : eng.snapshot().facts?.packageManager === "yarn" ? "yarn" : "npm"} install && ` : "";
        await openTerminal(w.dir, `${install}claude`);
        void this.refreshSide();
        return { flash: `New build ${path.basename(w.dir)} started in Terminal` };
      }
      case "reviewBuild": {
        if (!(await this.knownBuild(str("dir")))) return { flash: "That isn't one of this project's side builds" };
        const c = await eng.buildChanges(str("dir"), str("branch"));
        return { show: c.files.length ? `${path.basename(str("dir"))}: ${c.files.length} file${c.files.length === 1 ? "" : "s"}${c.unsaved ? ` (${c.unsaved} not saved yet)` : ""}\n\n${c.files.map((f) => `${f.status === "A" ? "added  " : f.status === "D" ? "deleted" : "changed"}  ${f.path}`).join("\n")}\n\nFull diff: git -C ${shellQuote(str("dir"))} diff ${c.base ?? "HEAD"}` : "No changes yet." };
      }
      case "mergeBuild": {
        const dir = str("dir");
        if (!(await this.knownBuild(dir))) return { flash: "That isn't one of this project's side builds" };
        const c = await eng.buildChanges(dir, str("branch"));
        if (!c.files.length) return { flash: "Nothing to merge yet" };
        let tests = "";
        let hasTest = false;
        try { hasTest = !!JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts?.test; } catch { /* none */ }
        if (hasTest && plan(eng.home).pro) {
          const t = await run("npm", ["test"], dir, { timeoutMs: 10 * 60_000 });
          if (t.code !== 0 && m.force !== true) return { confirmAgain: `Its tests FAIL. Merge anyway?`, force: true };
          tests = t.code === 0 ? " Its tests passed." : "";
        }
        if (c.unsaved) await eng.saveBuild(dir, `Work from ${path.basename(dir)} (saved by BuildPilot before merging)`);
        const r = await eng.mergeBuild(str("branch"));
        void this.refreshSide();
        if (r.merged) return { flash: `${r.message}${tests}` };
        if (r.conflicts.length) {
          const main = (await run("git", ["branch", "--show-current"], eng.currentProject!.root)).stdout.trim() || "main";
          await copyText(`In this folder (${dir}), run \`git merge ${main}\`, resolve the conflicts in: ${r.conflicts.join(", ")}. Keep both sides' intent; ask me if they truly contradict. Run the tests, commit, then tell me it's ready to merge.`);
          return { show: `${r.message}\n\nFiles: ${r.conflicts.join(", ")}\n\nA fix prompt is on your clipboard: paste it into the Claude in ${path.basename(dir)}, then merge again.` };
        }
        return { flash: r.message };
      }
      case "removeBuild": {
        if (!(await this.knownBuild(str("dir")))) return { flash: "That isn't one of this project's side builds" };
        try { await eng.removeBuild(str("dir")); } catch (e) { return { flash: (e as Error).message }; }
        void this.refreshSide();
        return { flash: "Removed (its branch is kept)" };
      }
      case "upgrade": { const g = gate(eng.home); openUrl(g.allowed ? checkoutUrl(readUsage(eng.home).installId) : g.paywall.url); return null; }
      case "enterLicense": { const v = saveLicense(eng.home, str("key")); return { flash: v.valid ? "BuildPilot Pro unlocked" : `That key didn't work (${v.reason})` }; }
      case "toggleTheme": { this.savePrefs({ theme: str("to") === "white" ? "white" : str("to") === "match" ? "match" : this.theme() === "match" ? "white" : "match" }); return null; }
      case "projects": {
        const rows = eng.store.all<{ root: string; name: string }>("SELECT root, name FROM projects ORDER BY COALESCE(last_analyzed_at, created_at) DESC LIMIT 15").filter((r) => fs.existsSync(r.root));
        return rows.map((r) => ({ root: r.root, name: path.basename(r.root) }));
      }
      case "selectProject": {
        const r = str("root");
        if (r && fs.existsSync(r)) { await eng.openProject(r); void this.refreshSide(); }
        return null;
      }
      case "more": return { show: "More tools are in the terminal:\n\n  bp            folder status, issues, next step\n  bp audit      check dependencies for known vulnerabilities\n  bp visual     check your running app + screenshot\n  bp handoff    summary for a new Claude chat\n  bp builds     side builds · bp review / bp merge / bp done\n  bp help       everything" };
      default: return null;
    }
  }

  private html(): string {
    const t = this.token;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BuildPilot</title><link rel="icon" href="/media/icon.png"><meta name="color-scheme" content="light"><link rel="stylesheet" href="/media/webview.css">
<style>.bp-modal{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9}.bp-box{background:#fff;color:#111;max-width:560px;width:calc(100% - 32px);border-radius:14px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.2);font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}.bp-box pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace;background:#f6f6f6;border-radius:8px;padding:10px;max-height:50vh;overflow:auto}.bp-box .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.bp-box button{font:inherit;border-radius:10px;padding:8px 16px;border:1px solid #d6d6d6;background:#fff;cursor:pointer}.bp-box button.ok{background:#2f5bea;color:#fff;border-color:#2f5bea;font-weight:600}.bp-box input{width:100%;font:inherit;padding:8px;border:1px solid #d6d6d6;border-radius:8px}.bp-box ul.pick{list-style:none;padding:0;margin:8px 0}.bp-box ul.pick button{display:block;width:100%;text-align:left;border:0;border-radius:8px;padding:8px 10px;background:none;color:#2f5bea;cursor:pointer}.bp-box ul.pick button:hover,.bp-box ul.pick button:focus-visible{background:#eef2ff;outline:2px solid #3352e8}</style>
</head><body><div id="app"><div class="loading">Starting BuildPilot…</div></div>
<script>
(() => {
  const T = ${JSON.stringify(t)};
  const H = { "content-type": "application/json", "x-bp-token": T };
  // Side effects are confirmed here, in plain words, before anything is sent.
  const CONFIRM = {
    connectAll: ["Connect BuildPilot to Claude Code?", "BuildPilot adds a few lines to ~/.claude/settings.json so it can see your builds, how full each chat is, and your plan limits. Your settings are backed up first, nothing leaves this computer, and Disconnect undoes it."],
    disconnect: ["Disconnect BuildPilot from Claude Code?", "Removes exactly the lines BuildPilot added and restores your own status line."],
    sendToClaude: ["Start Claude with this prompt?", "Opens Terminal in your project and starts Claude with it. Claude still asks before risky actions."],
    startFresh: ["Start a fresh chat?", "Your files are kept. BuildPilot copies a summary of the work so far and opens Claude in a new Terminal window. Paste the summary as your first message."],
    fixDoubleHooks: ["Remove BuildPilot's older hooks?", "Removes only BuildPilot's hook lines from ~/.claude/settings.json (backed up first). The plugin keeps BuildPilot connected, and your status line stays."],
    setupUndo: ["Turn on undo for this project?", "Sets up Git here and saves everything as a first save point. Nothing is uploaded."],
    checkpoint: ["Make a save point?", "Saves a snapshot of every file as a private Git ref. Your files and branch don't change."],
    mergeBuild: ["Bring this build's work into your main project?", "Its unsaved work is saved first. If both builds changed the same lines, nothing changes and you get a fix prompt."],
    hideIdle: ["Hide builds that have been quiet for 2+ hours?", "They disappear from the list. Their history is kept, and they come back if Claude does something there again."],
    undoFile: ["Put this file back to its last saved version?", "Undoes every change since your last commit for this one file. BuildPilot makes a safety save point of the current version first."],
    resumeBuild: ["Resume this Claude conversation?", "Opens Terminal in that folder and continues the same chat (claude --resume)."],
    removeBuild: ["Remove this build's folder?", "Its branch is kept, so nothing is lost. Folders with unsaved changes are never removed."],
  };
  const modal = (html, onReady) => new Promise((resolve) => {
    const prev = document.activeElement;
    const m = document.createElement("div"); m.className = "bp-modal"; m.innerHTML = '<div class="bp-box" role="dialog" aria-modal="true" aria-labelledby="bp-dlg-t">' + html.replace("<b>", '<b id="bp-dlg-t">') + "</div>";
    document.body.appendChild(m);
    const app = document.getElementById("app"); if (app) app.setAttribute("aria-hidden", "true");
    const done = (v) => { m.remove(); if (app) app.removeAttribute("aria-hidden"); if (prev && prev.focus) prev.focus(); resolve(v); };
    // keep Tab inside the dialog
    m.addEventListener("keydown", (e) => { if (e.key !== "Tab") return; const f = [...m.querySelectorAll("button, input, textarea, [href], [tabindex]:not([tabindex='-1'])")]; if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } });
    m.addEventListener("click", (e) => { if (e.target === m) done(null); });
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { document.removeEventListener("keydown", k); done(null); } });
    onReady(m.querySelector(".bp-box"), done);
  });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ask = (title, detail, ok = "OK") => modal("<b>" + esc(title) + "</b><p>" + esc(detail) + '</p><div class="row"><button data-x>Cancel</button><button class="ok" data-ok>' + esc(ok) + "</button></div>", (b, done) => { b.querySelector("[data-x]").onclick = () => done(false); const o = b.querySelector("[data-ok]"); o.onclick = () => done(true); o.focus(); });
  const show = (text) => modal("<pre>" + esc(text) + '</pre><div class="row"><button class="ok" data-ok>Close</button></div>', (b, done) => { const o = b.querySelector("[data-ok]"); o.onclick = () => done(true); o.focus(); });
  const input = (title, placeholder, password) => modal("<b>" + esc(title) + '</b><p><input type="' + (password ? "password" : "text") + '" placeholder="' + esc(placeholder) + '"></p><div class="row"><button data-x>Cancel</button><button class="ok" data-ok>OK</button></div>', (b, done) => { const i = b.querySelector("input"); i.focus(); i.onkeydown = (e) => { if (e.key === "Enter") done(i.value); }; b.querySelector("[data-x]").onclick = () => done(null); b.querySelector("[data-ok]").onclick = () => done(i.value); });
  const pick = (title, items) => modal("<b>" + esc(title) + '</b><ul class="pick">' + items.map((x, n) => '<li><button type="button" data-n="' + n + '">' + esc(x.name) + ' <span style="color:#5f6368">' + esc(x.root) + "</span></button></li>").join("") + '</ul><div class="row"><button data-x>Cancel</button></div>', (b, done) => { b.querySelectorAll("[data-n]").forEach((el) => (el.onclick = () => done(items[+el.dataset.n]))); b.querySelector("[data-x]").onclick = () => done(null); const first = b.querySelector("[data-n]"); if (first) first.focus(); });
  const post = async (m) => (await (await fetch("/api/msg", { method: "POST", headers: H, body: JSON.stringify(m) })).json()).result;
  const toast = (text) => { const el = document.getElementById("flash"); if (el) { el.textContent = text; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 2600); } };
  const pushState = async () => { try { const s = await (await fetch("/api/state", { headers: H })).json(); window.postMessage(s, "*"); } catch {} };
  let st = {};
  window.acquireVsCodeApi = () => ({
    getState: () => { try { return JSON.parse(localStorage.getItem("bp-view") || "{}"); } catch { return st; } },
    setState: (s) => { st = s; try { localStorage.setItem("bp-view", JSON.stringify(s)); } catch {} },
    postMessage: async (m) => {
      const reply = (result) => { if (m.id) window.postMessage({ type: "reply", id: m.id, result }, "*"); };
      if (m.type === "ready") { await pushState(); return reply(null); }
      if (CONFIRM[m.type] && !(await ask(CONFIRM[m.type][0], CONFIRM[m.type][1], "Continue"))) return reply(null);
      if (m.type === "showConnectChanges") { const r = await post(m); await show("BuildPilot adds these entries to ~/.claude/settings.json:\\n\\n" + r.show); return reply(null); }
      if (m.type === "enterLicense") { const k = await input("Paste your BuildPilot Pro key", "BP1.…", true); if (k) { const r = await post({ type: "enterLicense", key: k }); if (r?.flash) toast(r.flash); await pushState(); } return reply(null); }
      if (m.type === "newBuild") { const label = await input("New build: what's it for? (a few words)", "e.g. checkout page"); if (label === null) return reply(null); if (!(await ask("Start a new build in its own copy of the project?", "BuildPilot makes a separate copy next to your project (with your .env files), installs packages, and opens Claude in Terminal. Two builds use your plan limit about twice as fast.", "Start build"))) return reply(null); m.label = label; }
      if (m.type === "renameBuild") { const n = await input("Name this build (leave empty to clear)", "e.g. checkout page"); if (n === null) return reply(null); m.name = n; }
      if (m.type === "selectProject") { const list = await post({ type: "projects" }); const p = await pick("Choose a project", list || []); if (!p) return reply(null); m.root = p.root; }
      let r = await post(m);
      if (r && r.confirmAgain) { if (await ask(r.confirmAgain, "Merging now would bring failing code into your main project.", "Merge anyway")) r = await post({ ...m, force: true }); else return reply(null); }
      if (r && typeof r.paywall === "string") { if (await ask("Go Pro?", r.paywall.replace(/: https?:\\/\\/\\S+$/, "."), "Get Pro")) window.open(r.url, "_blank"); return reply(null); }
      if (r && r.show) await show(r.show);
      if (r && r.flash) toast(r.flash);
      reply(r ?? null);
      if (!["buildPrompt", "copy", "useInOpen"].includes(m.type)) pushState();
    },
  });
  setInterval(pushState, 3000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pushState(); });
})();
</script>
<script src="/media/webview.js"></script></body></html>`;
  }
}

