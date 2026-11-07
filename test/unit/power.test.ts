import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { activityFor, presentTense } from "../../src/core/activity";
import { parseTokens, kTokens } from "../../src/core/tokens";
import { parseRollout, codexSessions } from "../../src/core/codex";
import { claudeProcesses } from "../../src/core/termfind";
import { alertsFor, AlertMemory } from "../../src/core/alerts";
import { forecastFullAt, recordWeek } from "../../src/core/page";
import { Engine } from "../../src/core/engine";
import type { HookEvent, Session } from "../../src/core/types";
import type { PageData } from "../../src/core/page";
import { makeRepo, tmpDir } from "./helpers";

const NOW = 1_800_000_000_000;
const sess = (o: Partial<Session> = {}): Session => ({ id: "s1", projectId: null, cwd: "/p/shop", transcriptPath: null, status: "running", statusReason: "", currentTask: "fix login", model: null, permissionMode: null, startedAt: NOW - 3600_000, lastEventAt: NOW - 1000, endedAt: null, eventCount: 0, errorCount: 0, ...o });
let n = 0;
const ev = (hookEvent: string, summary: string, ts: number, o: Partial<HookEvent> = {}): HookEvent => ({ id: ++n, sessionId: "s1", hookEvent, ts, toolName: null, toolUseId: null, summary, filePath: null, isError: false, errorText: null, agentId: null, fingerprint: String(n), ...o });

describe("what it's doing now", () => {
  it("present tense from summaries, first line only", () => {
    expect(presentTense("Run: npm test")).toBe("Running npm test");
    expect(presentTense("✓ Edit checkout.tsx")).toBe("Editing checkout.tsx");
    expect(presentTense("Run: cd x && python3 - <<'EOF'\nimport os")).toBe("Running python3 - <<'EOF'");
  });

  it("unfinished tool = current action with start time; prompt = Thinking; errors and waiting command", () => {
    const a = activityFor(sess(), [ev("UserPromptSubmit", "Prompt: fix it", NOW - 300_000), ev("PreToolUse", "Run: npm test", NOW - 120_000, { toolUseId: "t1" })], NOW);
    expect(a).toMatchObject({ now: "Running npm test", nowSince: NOW - 120_000 });
    expect(activityFor(sess(), [ev("UserPromptSubmit", "Prompt: hi", NOW - 5000)], NOW).now).toBe("Thinking");
    const errs = activityFor(sess(), [ev("PostToolUseFailure", "✗ Run: npm test", NOW - 60_000, { isError: true, errorText: "Error: cannot find module 'x'" })], NOW);
    expect(errs.errors1h).toBe(1);
    expect(errs.lastErrors[0]).toMatch(/cannot find module/);
    const w = activityFor(sess({ status: "awaiting_approval" }), [ev("PermissionRequest", "Needs your approval: Run: npm install stripe", NOW - 10_000)], NOW);
    expect(w.waitingFor).toBe("Run: npm install stripe");
  });

  it("stopped mid-task only for real interruptions; compaction and auto-approve noticed; timeline newest first", () => {
    const open = [ev("UserPromptSubmit", "Prompt: build it", NOW - 3 * 3600_000), ev("PreToolUse", "Edit a.ts", NOW - 3 * 3600_000 + 1000)];
    expect(activityFor(sess({ lastEventAt: NOW - 3 * 3600_000 + 1000 }), open, NOW).stopped).toBe(true);
    expect(activityFor(sess({ endedAt: NOW - 1000, lastEventAt: NOW - 3 * 3600_000 }), open, NOW).stopped).toBe(false); // just ended: not "stopped"
    expect(activityFor(sess(), [...open, ev("Stop", "Finished", NOW - 2000)], NOW).stopped).toBe(false);
    const a = activityFor(sess({ permissionMode: "bypassPermissions" }), [ev("PreCompact", "Compacting", NOW - 60_000), ev("Stop", "x", NOW - 1000)], NOW);
    expect(a.autoApprove).toBe(true);
    expect(a.compactedAt).toBe(NOW - 60_000);
    expect(a.timeline[0]!.text).toBe("Finished its turn");
  });
});

describe("where the tokens went", () => {
  const line = (o: unknown) => JSON.stringify(o);
  const jsonl = [
    line({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 2, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0, output_tokens: 100 }, content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/p/package-lock.json" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(160_000) }] } }),
    line({ type: "assistant", message: { id: "m2", model: "claude-opus-5-5", usage: { input_tokens: 2, cache_read_input_tokens: 70000, output_tokens: 50, output_tokens_details: { thinking_tokens: 20 } }, content: [{ type: "tool_use", id: "t2", name: "Task", input: { description: "research" } }, { type: "tool_use", id: "t3", name: "Bash", input: { command: "npm test" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: [{ type: "text", text: "y".repeat(8000) }] }] } }),
    line({ type: "assistant", message: { id: "m2", usage: { input_tokens: 2, output_tokens: 50 }, content: [] } }), // duplicate id: counted once
    line({ type: "system", subtype: "compact_boundary" }),
  ].join("\n");

  it("baseline, context, models, subagents, compactions and the biggest tool outputs", () => {
    const r = parseTokens(jsonl, jsonl);
    expect(r.baseline).toBe(30002);
    expect(r.context).toBe(70002);
    expect(r.turns).toBe(2);
    expect(r.output).toBe(150);
    expect(r.thinking).toBe(20);
    expect(r.models).toEqual([["claude-opus-5-5", 2]]);
    expect(r.subagents).toBe(1);
    expect(r.compactions).toBe(1);
    expect(r.top[0]).toEqual({ label: "Read package-lock.json", tokens: 40000 });
    expect(r.top[1]).toEqual({ label: "Bash npm test", tokens: 2000 });
    expect(kTokens(40000)).toBe("40k");
  });
});

describe("Codex (read-only)", () => {
  const meta = JSON.stringify({ timestamp: new Date(NOW - 60_000).toISOString(), type: "session_meta", payload: { id: "abc", cwd: "/p/api" } });
  const at = (ms: number, payload: unknown) => JSON.stringify({ timestamp: new Date(ms).toISOString(), type: "event_msg", payload });
  it("working / idle / error, last message, tokens and limits from the rollout log", () => {
    const body = [meta, at(NOW - 50_000, { type: "task_started", model_context_window: 258400 }), at(NOW - 40_000, { type: "user_message", message: "add rate limiting" }), at(NOW - 30_000, { type: "token_count", info: { total_token_usage: { total_tokens: 12345 } }, rate_limits: { primary: { used_percent: 42, resets_in_seconds: 600 }, secondary: { used_percent: 10 } } })].join("\n");
    const s = parseRollout(meta, body, NOW - 30_000, NOW)!;
    expect(s).toMatchObject({ id: "codex-abc", folder: "api", status: "running", task: "add rate limiting", tokens: 12345, agent: "codex" });
    expect(s.limits).toMatchObject({ primaryPct: 42, secondaryPct: 10 });
    const done = parseRollout(meta, `${body}\n${at(NOW - 20_000, { type: "task_complete", error: { message: "You've hit your usage limit." } })}`, NOW - 20_000, NOW)!;
    expect(done).toMatchObject({ status: "failed", error: "You've hit your usage limit." });
  });

  it("scans only today/yesterday rollouts in CODEX_HOME", () => {
    const home = tmpDir();
    const d = new Date();
    const dir = path.join(home, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "rollout-x.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "z1", cwd: "/p/web" } })}\n`);
    expect(codexSessions(Date.now(), 3600_000, home).map((s) => s.folder)).toEqual(["web"]);
    expect(codexSessions(Date.now(), 3600_000, tmpDir())).toEqual([]);
  });
});

describe("find the terminal", () => {
  it("parses ps output: claude processes with a real terminal only", () => {
    const ps = " 1509 ttys000  claude\n 57602 ??  /Users/me/.local/bin/claude\n 2000 ttys003  node\n 37198 ttys001  /usr/local/bin/claude\n";
    expect(claudeProcesses(ps)).toEqual([{ pid: 1509, tty: "ttys000" }, { pid: 37198, tty: "ttys001" }]);
  });
});

describe("alerts", () => {
  const page = (o: Partial<PageData> = {}): PageData => ({ connected: true, builds: [], needs: 0, working: 0, billing: "plan", limits: { fiveHourPct: 10, fiveHourResetsAt: NOW + 3600_000, sevenDayPct: 5, sevenDayResetsAt: null, fullAt: null, forecastLocked: false }, costTodayUsd: null, tips: [], plan: { pro: true, licensed: true, trialDaysLeft: null, sellable: false, freeLeft: null, price: "$5/mo", points: [] }, ...o });
  it("first run is silent; then each alert once; limits once per window", () => {
    const mem: AlertMemory = { sent: {} };
    const b = { id: "s1", folder: "shop", cwd: "/p", status: "awaiting_approval" as const, word: "", reason: "", task: null, contextPct: null, lastEventAt: NOW, needsYou: true, next: null, waitingFor: "Run: npm i", share: null };
    expect(alertsFor(page({ builds: [b] }), mem, NOW)).toEqual([]); // seeded
    const hot = page({ limits: { ...page().limits, fiveHourPct: 85 }, builds: [{ ...b, lastEventAt: NOW + 1 }] });
    const a = alertsFor(hot, mem, NOW + 1000);
    expect(a.map((x) => x.key.split(":")[0]).sort()).toEqual(["80", "need"]);
    expect(a.find((x) => x.key.startsWith("need"))!.body).toMatch(/npm i/);
    expect(alertsFor(hot, mem, NOW + 2000)).toEqual([]);
  });
});

describe("forecast and weekly pace", () => {
  it("weights recent minutes: a sudden speed-up moves the forecast earlier than a straight line would", () => {
    const t0 = NOW;
    const slow = [[t0, 10], [t0 + 20 * 60_000, 12], [t0 + 40 * 60_000, 14]] as [number, number][];
    const fast = [...slow, [t0 + 50 * 60_000, 24], [t0 + 60 * 60_000, 34]] as [number, number][];
    const end = t0 + 60 * 60_000;
    const at = forecastFullAt({ resetsAt: null, samples: fast }, end)!;
    // Plain (unweighted) least squares for comparison.
    const n2 = fast.length;
    const mx = fast.reduce((a, [t]) => a + t, 0) / n2;
    const my = fast.reduce((a, [, p]) => a + p, 0) / n2;
    const slope = fast.reduce((a, [t, p]) => a + (t - mx) * (p - my), 0) / fast.reduce((a, [t]) => a + (t - mx) ** 2, 0);
    const plain = end + (100 - 34) / slope;
    expect(at).toBeLessThan(plain);
    expect(at).toBeGreaterThan(end);
  });

  it("records weekly % per day and predicts running out before the reset", () => {
    const home = tmpDir();
    const reset = NOW + 4 * 86400_000; // 3 days into the week
    const r = recordWeek(home, 60, reset, NOW);
    expect(r.week.at(-1)).toEqual({ day: "Today", pct: 60 });
    expect(r.weekFullAt).not.toBeNull(); // 60% in 3 days → 100% in 5 days < 7
    expect(recordWeek(home, 20, reset, NOW).weekFullAt).toBeNull();
  });
});

describe("who changed this file + undo", () => {
  it("finds the build that edited a file and puts it back to the last commit with a safety point", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    const repo = makeRepo({ "auth.ts": "export const ok = true;\n" });
    await engine.openProject(repo);
    const file = path.join(repo, "auth.ts");
    const now = Date.now();
    engine.store.run("INSERT INTO sessions (id, cwd, status, started_at, last_event_at) VALUES ('sx1', ?, 'running', ?, ?)", [repo, now, now]);
    engine.store.run("INSERT INTO events (session_id, hook_event, ts, tool_name, summary, file_path, fingerprint) VALUES ('sx1', 'PostToolUse', ?, 'Edit', '✓ Edit auth.ts', ?, 'f1')", [now, file]);
    expect(engine.fileHistory("auth.ts")).toMatchObject([{ sessionId: "sx1", path: file, edits: 1 }]);
    expect(engine.fileHistory("100%_weird")).toEqual([]);
    fs.writeFileSync(file, "broken by AI\n");
    const r = await engine.undoFile(file);
    expect(fs.readFileSync(file, "utf8")).toBe("export const ok = true;\n");
    expect(r.safety).toMatch(/^[0-9a-f]{40}$/);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString().trim()).toBe("");
    engine.stop();
  });

  it("hides idle builds (history kept)", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    const now = Date.now();
    engine.store.run("INSERT INTO sessions (id, cwd, status, started_at, last_event_at) VALUES ('old1', '/p', 'idle', ?, ?)", [now - 5 * 3600_000, now - 3 * 3600_000]);
    engine.store.run("INSERT INTO sessions (id, cwd, status, started_at, last_event_at) VALUES ('new1', '/p', 'running', ?, ?)", [now, now]);
    expect(engine.hideIdle(now)).toBe(1);
    expect(engine.store.scalar("SELECT COUNT(*) FROM sessions")).toBe(2);
    engine.stop();
  });
});

describe("short commands", () => {
  it("drops cd/env prefixes and pipes", async () => {
    const { shortCommand } = await import("../../src/core/activity");
    expect(shortCommand("cd ~/buildpilot && npm run lint 2>&1 | grep -E x")).toBe("npm run lint 2>&1");
    expect(shortCommand("FOO=1 BAR=2 npm test")).toBe("npm test");
    expect(shortCommand('cd "/a b" ; pytest -q')).toBe("pytest -q");
  });
});
