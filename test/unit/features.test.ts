import { execFileSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationApi, loadOrCreateToken, sendWebhook } from "../../src/core/api";
import { analyzeRepo } from "../../src/core/analyzer";
import { detectAppUrl, detectDrift, findBrowser, isLocalUrl, parseNpmAudit, parsePipAudit, visualCheck } from "../../src/core/checks";
import { Engine } from "../../src/core/engine";
import { installStatusline, readLiveStatus, STATUSLINE_SCRIPT, statuslineStatus, uninstallStatusline } from "../../src/core/hooks";
import { launchPlan } from "../../src/extension/launch";
import { Requirement } from "../../src/core/types";
import { makeRepo, tmpDir } from "./helpers";

const servers: http.Server[] = [];
const engines: Engine[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  engines.splice(0).forEach((e) => e.stop());
});
function serve(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(0, "127.0.0.1", () => resolve((s.address() as { port: number }).port));
  });
}

const STATUS_JSON = JSON.stringify({
  session_id: "sess-42",
  model: { id: "claude-opus-5-5", display_name: "Opus" },
  cost: { total_cost_usd: 1.234 },
  context_window: { total_input_tokens: 84000, context_window_size: 200000, used_percentage: 42, remaining_percentage: 58, current_usage: { input_tokens: 10, output_tokens: 5 } },
  rate_limits: { five_hour: { used_percentage: 23.5 }, seven_day: { used_percentage: 41.2 } },
});

describe("statusline integration", () => {
  it("script saves Claude Code's status JSON and prints a default line", () => {
    const home = tmpDir();
    fs.mkdirSync(path.join(home, "status"));
    const script = path.join(home, "statusline.sh");
    fs.writeFileSync(script, STATUSLINE_SCRIPT);
    const out = execFileSync("sh", [script], { input: STATUS_JSON, env: { ...process.env, BUILDPILOT_HOME: home } }).toString();
    expect(out).toBe("Opus · context 42% · BuildPilot\n");
    const live = readLiveStatus("sess-42", home)!;
    expect(live).toMatchObject({ contextPct: 42, contextSize: 200000, costUsd: 1.234, model: "Opus", fiveHourPct: 23.5, sevenDayPct: 41.2 });
  });
  it("chains an existing statusline unchanged and restores it exactly on uninstall", () => {
    const home = tmpDir();
    const file = path.join(tmpDir(), "settings.json");
    const original = { theme: "dark", statusLine: { type: "command", command: "echo MY-LINE", padding: 2 } };
    fs.writeFileSync(file, JSON.stringify(original));
    const r = installStatusline(file, home);
    expect(r.chained).toBe("echo MY-LINE");
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.statusLine.padding).toBe(2);
    expect(statuslineStatus(file, home)).toMatchObject({ installed: true, chainedOriginal: "echo MY-LINE" });
    const cmd: string = after.statusLine.command;
    const out = execFileSync("sh", ["-c", cmd], { input: STATUS_JSON, env: { ...process.env, BUILDPILOT_HOME: home } }).toString();
    expect(out.trim()).toBe("MY-LINE"); // user's display unchanged
    expect(readLiveStatus("sess-42", home)?.contextPct).toBe(42); // and BuildPilot still got the data
    uninstallStatusline(file, home);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(original);
  });
  it("installs cleanly when there was no statusline and removes it fully", () => {
    const home = tmpDir();
    const file = path.join(tmpDir(), "settings.json");
    fs.writeFileSync(file, JSON.stringify({ model: "opus" }));
    installStatusline(file, home);
    expect(statuslineStatus(file, home).installed).toBe(true);
    uninstallStatusline(file, home);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ model: "opus" });
  });
  it("rejects unsafe session ids when reading", () => {
    expect(readLiveStatus("../../etc/passwd", tmpDir())).toBeNull();
  });
});

describe("dependency audit parsing", () => {
  it("parses npm audit JSON", () => {
    const r = parseNpmAudit(JSON.stringify({
      vulnerabilities: { lodash: { severity: "high", fixAvailable: true, via: [{ title: "Prototype Pollution" }] }, minimist: { severity: "critical", fixAvailable: false, via: ["lodash"] } },
      metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 1, critical: 1, total: 5 } },
    }));
    expect(r.ok).toBe(true);
    expect(r.counts).toMatchObject({ critical: 1, high: 1, total: 5 });
    expect(r.top[0]).toMatchObject({ name: "minimist", severity: "critical" });
    expect(r.top[1]).toMatchObject({ name: "lodash", title: "Prototype Pollution", fixAvailable: true });
  });
  it("reports npm errors (e.g. offline) honestly", () => {
    expect(parseNpmAudit(JSON.stringify({ error: { summary: "request to registry failed" } })).ok).toBe(false);
    expect(parseNpmAudit("not json").ok).toBe(false);
  });
  it("parses pip-audit JSON", () => {
    const r = parsePipAudit(JSON.stringify({ dependencies: [{ name: "flask", vulns: [{ id: "PYSEC-1", fix_versions: ["2.3"] }] }, { name: "x", vulns: [] }] }));
    expect(r.counts.total).toBe(1);
    expect(r.top[0]).toMatchObject({ name: "flask", fixAvailable: true });
  });
});

describe("requirements drift", () => {
  const req = (title: string): Requirement => ({ id: title, projectId: "p", title, acceptance: "", status: "todo", evidence: "unknown", evidenceNote: "", source: "user", createdAt: 0, updatedAt: 0 });
  it("flags prompts that match no requirement and ignores short ones", () => {
    const d = detectDrift(["Add a dark mode toggle to settings", "Fix the invoice email sending", "continue", "yes do it"], [req("Send invoices by email"), req("Settings page")]);
    expect(d).toEqual([]); // both substantive prompts share words with requirements
    const d2 = detectDrift(["Build a crypto wallet integration", "Send invoice reminders"], [req("Send invoices by email")]);
    expect(d2).toEqual(["Build a crypto wallet integration"]);
  });
  it("does nothing without requirements", () => {
    expect(detectDrift(["anything at all here"], [])).toEqual([]);
  });
});

describe("visual QA", () => {
  it("detects the app address from scripts and frameworks", async () => {
    const a = await analyzeRepo(makeRepo({ "package.json": JSON.stringify({ scripts: { dev: "vite --port 4100" }, devDependencies: { vite: "5" } }) }));
    expect(detectAppUrl(a)).toEqual({ url: "http://localhost:4100", basis: "`dev` script" });
    const b = await analyzeRepo(makeRepo({ "package.json": JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "15" } }) }));
    expect(detectAppUrl(b).url).toBe("http://localhost:3000");
    expect(detectAppUrl(b, "http://localhost:9999").url).toBe("http://localhost:9999");
  });
  it("only allows local addresses", () => {
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:8080/x")).toBe(true);
    expect(isLocalUrl("https://example.com")).toBe(false);
    expect(isLocalUrl("file:///etc/passwd")).toBe(false);
  });
  it("checks a running app, spots error pages, and screenshots when a browser exists", async () => {
    const port = await serve((req, res) => {
      res.writeHead(req.url === "/broken" ? 500 : 200, { "content-type": "text/html" });
      res.end(req.url === "/broken" ? "<html><body><h1>Internal Server Error</h1></body></html>" : "<html><head><title>Invoices</title></head><body><h1>Welcome to invoices</h1><p>Create your first invoice.</p></body></html>");
    });
    const out = tmpDir();
    const ok = await visualCheck(`http://127.0.0.1:${port}/`, out);
    expect(ok).toMatchObject({ reachable: true, status: 200, title: "Invoices", errorText: null, looksBlank: false });
    if (findBrowser()) expect(ok.screenshot && fs.statSync(ok.screenshot).size).toBeGreaterThan(1000);
    const bad = await visualCheck(`http://127.0.0.1:${port}/broken`, out, null);
    expect(bad.errorText).toMatch(/Internal Server Error/);
    const down = await visualCheck("http://127.0.0.1:1/", out, null);
    expect(down.reachable).toBe(false);
  }, 60000);
});

describe("webhooks", () => {
  it("sends ntfy-style and generic JSON alerts", async () => {
    const got: { headers: http.IncomingHttpHeaders; body: string; url: string }[] = [];
    const port = await serve((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        got.push({ headers: req.headers, body: b, url: req.url ?? "" });
        res.end("ok");
      });
    });
    const alert = { key: "k", level: "error" as const, title: "Claude needs your approval", message: "Run: npm publish" };
    await sendWebhook(`http://127.0.0.1:${port}/topic?ntfy=1`, alert, "invoice-app");
    await sendWebhook(`http://localhost:${port}/hook`, alert, "invoice-app");
    expect(got[0]!.body).toBe("Claude needs your approval: Run: npm publish");
    expect(got[0]!.headers.title).toBe("BuildPilot · invoice-app");
    expect(got[0]!.headers.priority).toBe("high");
    expect(JSON.parse(got[1]!.body)).toMatchObject({ source: "buildpilot", project: "invoice-app", level: "error" });
  });
  it("refuses plain http to remote hosts", async () => {
    await expect(sendWebhook("http://example.com/x", { key: "k", level: "info", title: "t", message: "" }, "p")).rejects.toThrow(/https/);
  });
});

describe("Pocket page & API", () => {
  it("serves the static page without a token but keeps data behind it", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    engines.push(engine);
    await engine.start();
    await engine.openProject(makeRepo({ "a.js": "1" }));
    const api = new IntegrationApi(engine, { port: 47998, host: "127.0.0.1", token: loadOrCreateToken(home) });
    await api.start();
    try {
      const page = await fetch("http://127.0.0.1:47998/pocket");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("BuildPilot Pocket");
      expect(page.headers.get("content-type")).toMatch(/text\/html/);
      expect(html).toMatch(/Content-Security-Policy" content="default-src 'none'; connect-src 'self'/);
      expect(html).toContain("speechSynthesis");
      expect((await fetch("http://127.0.0.1:47998/v1/sessions")).status).toBe(401);
    } finally {
      await api.stop();
    }
  });
});

describe("worktree assistant", () => {
  it("creates a separate worktree on a new branch without touching the project", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    engines.push(engine);
    await engine.start();
    const repo = makeRepo({ "a.txt": "1\n" });
    fs.writeFileSync(path.join(repo, "a.txt"), "dirty\n");
    await engine.openProject(repo);
    const w = await engine.createWorktree("Invoice PDF");
    expect(fs.existsSync(path.join(w.dir, "a.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(w.dir, "a.txt"), "utf8")).toBe("1\n");
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8")).toBe("dirty\n"); // untouched
    expect(execFileSync("git", ["branch", "--show-current"], { cwd: repo }).toString().trim()).not.toBe(w.branch);
    expect(w.branch).toMatch(/^buildpilot\/invoice-pdf-\d+$/);
    expect(engine.decisions()[0]!.title).toMatch(/worktree/);
  });
});

describe("Start in Claude Code launch command", () => {
  it("passes the prompt as one exact argument in a POSIX shell, without evaluating it", () => {
    const dir = tmpDir();
    const prompt = `Fix "quotes" and 'single' $(touch ${dir}/PWNED) \`id\` $HOME\nline 2 & ; |`;
    const file = path.join(dir, "it's prompt.md");
    fs.writeFileSync(file, prompt);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nprintf '%s' "$#" > "${dir}/argc"\nprintf '%s' "$1" > "${dir}/arg1"\n`, { mode: 0o755 });
    const plan = launchPlan(file, "darwin", "/bin/zsh");
    expect(plan.kind).toBe("command");
    execFileSync("sh", ["-c", plan.text], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    expect(fs.readFileSync(path.join(dir, "argc"), "utf8")).toBe("1");
    expect(fs.readFileSync(path.join(dir, "arg1"), "utf8")).toBe(prompt);
    expect(fs.existsSync(path.join(dir, "PWNED"))).toBe(false);
  });
  it("uses Get-Content on PowerShell and clipboard paste on cmd", () => {
    expect(launchPlan("C:\\a'b.md", "win32", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toEqual({ kind: "command", text: "claude (Get-Content -Raw 'C:\\a''b.md')" });
    expect(launchPlan("C:\\a.md", "win32", "C:\\Windows\\System32\\cmd.exe").kind).toBe("paste");
    expect(launchPlan("/x.md", "win32", "C:\\Program Files\\Git\\bin\\bash.exe").kind).toBe("command");
  });
});

import { supervise, SupervisorInput } from "../../src/core/supervisor";
import { HookEvent, Session } from "../../src/core/types";

describe("supervisor rules for new signals", () => {
  const now = 10_000_000;
  const sess = (id: string): Session => ({ id, projectId: "p", cwd: "/p", transcriptPath: null, status: "running", statusReason: "", currentTask: null, model: null, permissionMode: null, startedAt: now - 1000, lastEventAt: now - 1000, endedAt: null, eventCount: 1, errorCount: 0 });
  const edit = (sid: string, file: string): HookEvent => ({ id: Math.random(), sessionId: sid, hookEvent: "PostToolUse", ts: now - 500, toolName: "Edit", toolUseId: null, summary: "Edit", filePath: file, isError: false, errorText: null, agentId: null, fingerprint: String(Math.random()) });
  const base = (o: Partial<SupervisorInput> = {}): SupervisorInput => ({ now, facts: null, changes: null, sessions: [], eventsBySession: new Map(), testRuns: [], requirements: [], doctor: [], secrets: [], hooksInstalled: true, claudeInstalled: true, dismissed: new Set(), hasCheckpointSinceChanges: true, ...o });
  it("recommends a handoff when context is nearly full, and warns on rate limits", () => {
    const live = { a: { sessionId: "a", updatedAt: now, contextPct: 96, contextSize: 200000, contextTokens: 192000, costUsd: 3, model: "Opus", fiveHourPct: 91, sevenDayPct: 10 } };
    const out = supervise(base({ sessions: [sess("a")], live }));
    const ctx = out.recommendations.find((r) => r.key === "context:a")!;
    expect(ctx.severity).toBe("high");
    expect(ctx.action).toMatchObject({ kind: "prompt", goal: "handoff" });
    expect(out.recommendations.some((r) => r.key === "rate-limit-5h")).toBe(true);
  });
  it("turns high/critical vulnerabilities into an issue, a fix prompt and a failed readiness item", () => {
    const audit = { ranAt: now, tool: "npm audit" as const, ok: true, counts: { critical: 1, high: 0, moderate: 0, low: 0, info: 0, total: 1 }, top: [{ name: "minimist", severity: "critical", fixAvailable: true, title: "Prototype Pollution" }], error: null };
    const out = supervise(base({ audit }));
    expect(out.issues.find((i) => i.key === "vulns")?.severity).toBe("high");
    expect(out.recommendations.find((r) => r.key === "vulns")?.action).toMatchObject({ kind: "prompt", goal: "security" });
    expect(out.readiness.find((r) => r.key === "deps")?.status).toBe("failed");
  });
  it("offers a worktree when two sessions edit the same file", () => {
    const out = supervise(base({ sessions: [sess("a"), sess("b")], eventsBySession: new Map([["a", [edit("a", "/p/x.ts")]], ["b", [edit("b", "/p/x.ts")]]]) }));
    expect(out.recommendations.find((r) => r.key.startsWith("conflict:"))?.action?.kind).toBe("worktree");
  });
  it("reports drift as a low-priority nudge to the Memory tab", () => {
    const out = supervise(base({ drift: ["Build a crypto wallet", "Add AR try-on"] }));
    expect(out.recommendations.find((r) => r.key === "drift")?.action).toEqual({ kind: "open_tab", tab: "memory" });
  });
});

import { cleanPrompt } from "../../src/core/ingest";
describe("prompt cleanup", () => {
  it("labels system-injected messages and pastes instead of showing markup", () => {
    expect(cleanPrompt('<cross-session-message from="x">hi</cross-session-message>')).toBe("Message from another Claude session");
    expect(cleanPrompt("<task-notification><task-id>1</task-id></task-notification>")).toBe("Background task update");
    expect(cleanPrompt('do this <pasted_content id="a">\nlots\n</pasted_content id="a"> please')).toBe("do this [pasted text] please");
    expect(cleanPrompt('<pasted_content id="a">\nx\n</pasted_content id="a">')).toBe("[pasted text]");
    expect(cleanPrompt("<command-name>/review</command-name><command-message>review</command-message>")).toBe("Ran /review");
    expect(cleanPrompt("Fix the login bug")).toBe("Fix the login bug");
  });
});

describe("current task ignores injected messages", () => {
  it("keeps the user's last real prompt as the task", async () => {
    const { Store } = await import("../../src/core/db");
    const { Ingestor, rowToSession } = await import("../../src/core/ingest");
    const store = await Store.open(null);
    const ing = new Ingestor(store, () => null);
    ing.ingestRaw(JSON.stringify({ session_id: "s", cwd: "/p", hook_event_name: "UserPromptSubmit", prompt: "Add a pricing page" }), 1);
    ing.ingestRaw(JSON.stringify({ session_id: "s", cwd: "/p", hook_event_name: "UserPromptSubmit", prompt: '<cross-session-message from="x">hey</cross-session-message>' }), 2);
    expect(rowToSession(store.get("SELECT * FROM sessions")!).currentTask).toBe("Add a pricing page");
  });
});

import { installShell, shellStatus, uninstallShell } from "../../src/core/shell";
import { glance } from "../../src/core/glance";
describe("terminal integration", () => {
  it("adds a marked block to the rc file and removes it exactly", () => {
    const home = tmpDir();
    const rc = path.join(tmpDir(), ".zshrc");
    const original = "export PATH=$HOME/bin:$PATH\nalias ll='ls -la'\n";
    fs.writeFileSync(rc, original);
    const dist = tmpDir();
    fs.writeFileSync(path.join(dist, "cli.js"), "console.log('x')");
    const r = installShell(dist, home, [rc]);
    expect(r.changed).toEqual([rc]);
    expect(fs.readFileSync(rc, "utf8")).toContain("# >>> BuildPilot >>>");
    expect(fs.existsSync(path.join(home, "bin", "cli.js"))).toBe(true);
    expect(shellStatus([rc]).installed).toBe(true);
    expect(installShell(dist, home, [rc]).changed).toEqual([]); // idempotent
    uninstallShell(home, [rc]);
    expect(fs.readFileSync(rc, "utf8")).toBe(original);
  });
  it("shell.sh only prints in interactive terminals and respects BUILDPILOT_QUIET", () => {
    const home = tmpDir();
    const dist = tmpDir();
    fs.writeFileSync(path.join(dist, "cli.js"), "console.log('GLANCE')");
    installShell(dist, home, [path.join(tmpDir(), ".zshrc")]);
    const sh = path.join(home, "shell.sh");
    expect(execFileSync("sh", ["-c", `. "${sh}"; bp hi`]).toString()).toBe("GLANCE\n"); // bp works
    expect(execFileSync("sh", ["-c", `. "${sh}"`]).toString()).toBe(""); // non-interactive: silent
  });
  it("glance lists sessions needing you first, uses words not just color, and fits narrow terminals", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    engines.push(engine);
    await engine.start();
    const ing = (o: Record<string, unknown>, ts: number) => fs.writeFileSync(path.join(home, "spool", `${ts}.json`), JSON.stringify(o));
    const now = Date.now();
    ing({ session_id: "aaa", cwd: "/work/web-app", hook_event_name: "UserPromptSubmit", prompt: "Add a pricing page with three plans" }, now - 5000);
    ing({ session_id: "bbb", cwd: "/work/api", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm publish" } }, now - 4000);
    engine.drainNow();
    const out = glance(engine, { cwd: "/work", columns: 60, color: false, now });
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/2 Claude sessions.*1 needs you/);
    expect(lines[1]).toMatch(/! api\s+needs approval/);
    expect(lines[2]).toMatch(/● web-app\s+working/);
    expect(out).not.toMatch(/\x1b\[/); // NO_COLOR respected
    for (const l of lines.slice(0, -1)) expect(l.length).toBeLessThanOrEqual(62);
  });
});

describe("metrics", () => {
  it("are honest: unknown shows a dash, and each explains why it matters", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    engines.push(engine);
    await engine.start();
    await engine.openProject(makeRepo({ "package.json": JSON.stringify({ name: "m", scripts: { test: "node -e 0" } }) }));
    const m = engine.snapshot().metrics;
    expect(m.map((x) => x.key)).toEqual(["sessions", "context", "limit", "tests", "unsaved", "errors"]);
    expect(m.find((x) => x.key === "tests")).toMatchObject({ value: "—", confidence: "unknown" });
    expect(m.find((x) => x.key === "context")).toMatchObject({ value: "—", confidence: "unknown" });
    for (const x of m) expect(x.why.length).toBeGreaterThan(30);
    await engine.runScript("test");
    expect(engine.snapshot().metrics.find((x) => x.key === "tests")).toMatchObject({ value: "Passing", tone: "good", confidence: "verified" });
  });
});
