/**
 * Regressions from the model-based pass (2026-11-17, test/model). Each test is the minimal sequence the generator
 * shrank a failure to, written as a plain unit test.
 */
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine";
import { Store } from "../../src/core/db";
import { Ingestor } from "../../src/core/ingest";
import { hideQuiet, widgetData } from "../../src/core/glance";
import { IntegrationApi } from "../../src/core/api";
import { UiServer } from "../../src/core/uiserver";
import { makeRepo, tmpDir } from "./helpers";

const SID = "aaaa0000-0000-4000-8000-000000000001";
const ev = (o: Record<string, unknown>) => JSON.stringify({ session_id: SID, cwd: "/Users/x/proj", transcript_path: "/x.jsonl", ...o });

async function ingestor() {
  const store = await Store.open(null);
  return { store, ing: new Ingestor(store, () => null), row: () => store.get<Record<string, unknown>>("SELECT * FROM sessions WHERE id = ?", [SID])! };
}

describe("late (out-of-order) events never roll a session back", () => {
  it("an old SessionStart arriving after SessionEnd doesn't reopen the session", async () => {
    const { ing, row } = await ingestor();
    ing.ingestRaw(ev({ hook_event_name: "SessionStart", source: "startup" }), 1_000);
    ing.ingestRaw(ev({ hook_event_name: "SessionEnd", reason: "exit" }), 9_000);
    ing.ingestRaw(ev({ hook_event_name: "SessionStart", source: "resume", n: 2 }), 4_000); // delivered late
    expect(row().ended_at).toBe(9_000);
    expect(row().status).toBe("completed");
  });
  it("an older prompt delivered late doesn't replace the newer request", async () => {
    const { ing, row } = await ingestor();
    ing.ingestRaw(ev({ hook_event_name: "UserPromptSubmit", prompt: "second request" }), 20_000);
    ing.ingestRaw(ev({ hook_event_name: "UserPromptSubmit", prompt: "first request" }), 10_000);
    expect(row().current_task).toBe("second request");
  });
  it("an older TodoWrite delivered late doesn't roll Claude's checklist back", async () => {
    const { ing, row } = await ingestor();
    const todo = (st: string) => ({ hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_input: { todos: [{ content: "a", status: "completed" }, { content: "b", status: st }] } });
    ing.ingestRaw(ev(todo("completed")), 20_000);
    ing.ingestRaw(ev(todo("pending")), 10_000);
    expect(JSON.parse(String(row().checklist)).done).toBe(2);
  });
  it("each event is one transaction (nested use is fine)", async () => {
    const { store } = await ingestor();
    expect(store.transaction(() => store.transaction(() => 7))).toBe(7);
    expect(() => store.transaction(() => { throw new Error("x"); })).toThrow("x");
    expect(store.transaction(() => 1)).toBe(1); // usable again after a rollback
  });
});

describe("Clear them hides only what the page lists as quiet", () => {
  it("a session waiting for your OK for 3 hours is never hidden", async () => {
    const home = tmpDir();
    const e = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await e.start();
    const now = Date.now(); const ing = (e as unknown as { ingestor: Ingestor }).ingestor;
    const cwd = "/Users/model-test/proj"; // not a temp folder (those are hidden as background runs)
    ing.ingestRaw(JSON.stringify({ session_id: "need0000-0000-4000-8000-000000000001", cwd, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "ls" } }), now - 3 * 3600_000);
    ing.ingestRaw(JSON.stringify({ session_id: "idle0000-0000-4000-8000-000000000002", cwd, hook_event_name: "Stop" }), now - 3 * 3600_000);
    expect(hideQuiet(e, now)).toBe(1);
    const left = widgetData(e, now).sessions.map((s) => s.id);
    expect(left).toContain("need0000-0000-4000-8000-000000000001");
    expect(left).not.toContain("idle0000-0000-4000-8000-000000000002");
    e.stop();
  });
});

const post = (port: number, p: string, body: string, headers: Record<string, string>) => new Promise<{ status: number; text: string }>((resolve, reject) => {
  const q = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, text: t })); });
  q.on("error", reject); q.end(body);
});

describe("servers refuse bad input instead of failing", () => {
  let engine: Engine; let api: IntegrationApi; let ui: UiServer; let apiPort = 0;
  beforeAll(async () => {
    const home = tmpDir();
    fs.writeFileSync(path.join(home, "usage.json"), JSON.stringify({ installId: "test-install-0001", count: 0, firstRun: Date.now() }));
    engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    await engine.openProject(makeRepo({ "package.json": "{}" }));
    api = new IntegrationApi(engine, { port: 0, host: "127.0.0.1", token: "t".repeat(32) });
    await api.start(); apiPort = Number(/:(\d+)$/.exec(api.address)![1]);
    ui = new UiServer(engine, { media: tmpDir() }); await ui.start();
  });
  afterAll(async () => { await api.stop(); await ui.stop(); engine.stop(); });
  const auth = { authorization: `Bearer ${"t".repeat(32)}` };
  it("Integration API: a `null` body is a 400 and the API keeps answering", async () => {
    for (const b of ["null", "7", "[1]", "\"x\""]) expect((await post(apiPort, "/v1/prompt", b, auth)).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { headers: auth })).status).toBe(200);
  });
  it("Integration API: over 20,000 characters is answered 413 (not a dropped connection)", async () => {
    expect((await post(apiPort, "/v1/prompt", JSON.stringify({ request: "a".repeat(25_000) }), auth)).status).toBe(413);
  });
  it("window API: bad JSON is 400, a body too large is 413 and the next request still works", async () => {
    const h = { "x-bp-token": ui.token, host: `127.0.0.1:${ui.port}` };
    expect((await post(ui.port!, "/api/msg", "{nope", h)).status).toBe(400);
    expect((await post(ui.port!, "/api/msg", "null", h)).status).toBe(400);
    expect((await post(ui.port!, "/api/msg", JSON.stringify({ type: "copy", text: "a".repeat(400_000) }), h)).status).toBe(413);
    expect((await post(ui.port!, "/api/msg", JSON.stringify({ type: "ready" }), h)).status).toBe(200);
  });
  it("window API: a field that isn't a string counts as empty (an object can't crash it or become a name)", async () => {
    const h = { "x-bp-token": ui.token, host: `127.0.0.1:${ui.port}` };
    const r = await post(ui.port!, "/api/msg", JSON.stringify({ type: "renameBuild", id: SID, name: { toString: "x", a: 1 } }), h);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).result.flash).toBe("Name cleared");
  });
});

describe("plugin slash commands never put the user's words on a shell command line", () => {
  const dir = path.join(__dirname, "../../plugin/commands");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    it(f, () => {
      const md = fs.readFileSync(path.join(dir, f), "utf8");
      const bang = /!`([^`]+)`/.exec(md)?.[1] ?? "";
      expect(bang).not.toContain("$ARGUMENTS");
      if (md.includes("$ARGUMENTS")) expect(md).toMatch(/--stdin <<'BP_[A-Z]+_END_7c41'/);
    });
  }
});

describe("session names", () => {
  it("control characters become spaces (a NUL used to cut the name short)", async () => {
    const { setBuildName, buildName } = await import("../../src/core/glance");
    const home = tmpDir();
    const e = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") }); await e.start();
    setBuildName(e, SID, "a\u0000b \u001b[31mred");
    expect(buildName(e, SID)).toBe("a b [31mred");
    e.stop();
  });
});
