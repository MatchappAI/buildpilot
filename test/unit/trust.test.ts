import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { isCorruption, Store, usesWal } from "../../src/core/db";
import { Ingestor, rowToSession, SpoolReader } from "../../src/core/ingest";
import { Session } from "../../src/core/types";
import { payload, tmpDir } from "./helpers";

/** Phase A of docs/COMPANION_PLAN.md: the status shown must match what Claude Code actually did. */
async function ingestor(): Promise<{ store: Store; ing: Ingestor }> {
  const store = await Store.open(null);
  return { store, ing: new Ingestor(store, () => null) };
}
const session = (store: Store, id = "s1"): Session => rowToSession(store.get("SELECT * FROM sessions WHERE id = ?", [id])!);

describe("trust: duplicate handling", () => {
  it("a second identical Stop later in the session still counts (session returns to idle)", async () => {
    const { store, ing } = await ingestor();
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "yes" }), 1_000);
    ing.ingestRaw(payload({ hook_event_name: "Stop" }), 20_000);
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "yes" }), 60_000);
    expect(session(store).status).toBe("running");
    expect(ing.ingestRaw(payload({ hook_event_name: "Stop" }), 90_000).accepted).toBe(true);
    expect(session(store).status).toBe("idle");
    expect(session(store).eventCount).toBe(4);
  });
  it("the same event delivered twice within seconds (plugin + settings hooks) is recorded once, even across a window edge", async () => {
    const { store, ing } = await ingestor();
    const p = payload({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "t1" });
    expect(ing.ingestRaw(p, 9_999).accepted).toBe(true);
    expect(ing.ingestRaw(p, 10_001).duplicate).toBe(true);
    expect(session(store).eventCount).toBe(1);
  });
  it("a second idle notice after an interrupt is not dropped", async () => {
    const { store, ing } = await ingestor();
    const idle = payload({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" });
    ing.ingestRaw(idle, 1_000);
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "go" }), 30_000);
    expect(ing.ingestRaw(idle, 120_000).accepted).toBe(true);
    expect(session(store).status).toBe("idle");
  });
});

describe("trust: status can't be flipped by the wrong event", () => {
  it("subagent tool calls don't put a finished session back to working", async () => {
    const { store, ing } = await ingestor();
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "research" }), 1_000);
    ing.ingestRaw(payload({ hook_event_name: "Stop" }), 2_000);
    ing.ingestRaw(payload({ hook_event_name: "PreToolUse", tool_name: "Grep", tool_use_id: "a1", agent_id: "ag1" }), 60_000);
    expect(session(store).status).toBe("idle");
  });
  it("a subagent asking for approval still marks the session as needing you", async () => {
    const { store, ing } = await ingestor();
    ing.ingestRaw(payload({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm i" }, agent_id: "ag1" }), 1_000);
    expect(session(store).status).toBe("awaiting_approval");
  });
  it("a late background tool event right after Stop doesn't restart the session", async () => {
    const { store, ing } = await ingestor();
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "x" }), 1_000);
    ing.ingestRaw(payload({ hook_event_name: "Stop" }), 5_000);
    ing.ingestRaw(payload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "t9", tool_input: { command: "ls" } }), 5_400);
    expect(session(store).status).toBe("idle");
  });
  it("a session hidden as idle comes back when Claude works there again", async () => {
    const { store, ing } = await ingestor();
    ing.ingestRaw(payload({ hook_event_name: "Stop" }), 1_000);
    store.run("UPDATE sessions SET ended_at = 2000, status = 'completed', status_reason = 'Hidden as idle'", []);
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "back" }), 10_000_000);
    expect(session(store).endedAt).toBeNull();
    expect(session(store).status).toBe("running");
  });
});

describe("trust: spool reader", () => {
  it("doesn't wake itself up (its own heartbeat file isn't an event)", async () => {
    const { ing } = await ingestor();
    const dir = tmpDir();
    const sp = new SpoolReader(dir, ing, () => undefined);
    let drains = 0;
    const orig = sp.drain.bind(sp);
    sp.drain = (limit?: number) => {
      drains++;
      return orig(limit);
    };
    sp.start();
    await new Promise((r) => setTimeout(r, 1500));
    sp.stop();
    expect(drains).toBeLessThanOrEqual(3); // the start drain (+ at most a stray watcher event), never a loop
  });
  it("events arriving together are read in one batch", async () => {
    const { ing } = await ingestor();
    const dir = tmpDir();
    let batches = 0;
    let total = 0;
    const sp = new SpoolReader(dir, ing, (n) => {
      batches++;
      total += n;
    });
    sp.start();
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, `e${i}.json`), payload({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: `t${i}` }));
    for (let w = 0; w < 40 && total < 20; w++) await new Promise((r) => setTimeout(r, 100));
    sp.stop();
    expect(total).toBe(20);
    expect(batches).toBeLessThan(5); // batched, never one pass per file
  });
});

describe("trust: database safety", () => {
  it("only real damage counts as corruption (busy/locked never moves your history aside)", () => {
    expect(isCorruption(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }))).toBe(false);
    expect(isCorruption(new Error("EACCES: permission denied"))).toBe(false);
    expect(isCorruption(new Error("database disk image is malformed"))).toBe(true);
    expect(isCorruption(new Error("file is not a database"))).toBe(true);
  });
  it("detects a database shared in WAL mode", async () => {
    const dir = tmpDir();
    const f = path.join(dir, "x.db");
    const s = await Store.open(f);
    s.run("CREATE TABLE IF NOT EXISTS t (a)", []);
    if (s.backend === "node:sqlite") expect(usesWal(f)).toBe(true);
    expect(usesWal(path.join(dir, "missing.db"))).toBe(false);
  });
});

describe("trust: older Node never overwrites a shared database", () => {
  it("the sql.js fallback opens a WAL-mode file read-only", async () => {
    const dir = tmpDir();
    const f = path.join(dir, "x.db");
    const a = await Store.open(f);
    if (a.backend !== "node:sqlite") return; // nothing to share on this runtime
    a.run("CREATE TABLE IF NOT EXISTS t (a)", []);
    a.run("INSERT INTO t VALUES (1)", []);
    const before = fs.statSync(f).ino;
    process.env.BUILDPILOT_FORCE_SQLJS = "1";
    try {
      const b = await Store.open(f);
      expect(b.backend).toBe("sql.js");
      b.run("CREATE TABLE IF NOT EXISTS t2 (a)", []);
      b.close();
    } finally {
      delete process.env.BUILDPILOT_FORCE_SQLJS;
    }
    expect(fs.statSync(f).ino).toBe(before); // never replaced under the WAL writer
    expect(a.all("SELECT a FROM t", [])).toHaveLength(1);
  });
});

import { costBaselines } from "../../src/core/page";
describe("trust: today's usage means today", () => {
  it("a session started yesterday only counts what it added today", () => {
    const home = tmpDir();
    const mid = new Date(2026, 10, 8).getTime();
    expect(costBaselines(home, mid, [{ id: "old", cost: 12, startedToday: false }, { id: "new", cost: 3, startedToday: true }])).toEqual({ old: 12, new: 0 });
    // later the same day: baselines stay put
    expect(costBaselines(home, mid, [{ id: "old", cost: 15, startedToday: false }])).toMatchObject({ old: 12 });
    // next day: fresh baselines
    expect(costBaselines(home, mid + 86_400_000, [{ id: "old", cost: 15, startedToday: false }])).toEqual({ old: 15 });
  });
});

import { redact } from "../../src/core/redact";
describe("trust: redaction covers common command-line secrets", () => {
  it.each([
    ["git clone https://bob:hunter22@github.com/x/y", "hunter22"],
    ["curl -H 'x-api-key: abcdef123456' https://api.x", "abcdef123456"],
    ["curl -H \"X-Auth-Token: zzzz99998888\"", "zzzz99998888"],
    ["psql --password s3cretpw", "s3cretpw"],
    ["tool --token=tok_abcdef", "tok_abcdef"],
    ["mysql -u root -pSuperSecret db", "SuperSecret"],
  ])("%s", (input, secret) => {
    expect(redact(input)).not.toContain(secret);
  });
  it("leaves ordinary commands alone", () => {
    expect(redact("npm run test -- --watch")).toBe("npm run test -- --watch");
    expect(redact("ls -p src")).toBe("ls -p src");
  });
});
