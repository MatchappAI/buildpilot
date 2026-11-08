import { describe, expect, it } from "vitest";
import { risksIn, turnSummary } from "../../src/core/activity";
import { Store } from "../../src/core/db";
import { Ingestor, nextChecklist, rowToEvent, rowToSession } from "../../src/core/ingest";
import { payload } from "./helpers";

/** Phase C: "where is it at" and "is it really done" from observed events only. */
async function setup() {
  const store = await Store.open(null);
  const ing = new Ingestor(store, () => null);
  const events = () => store.all<Record<string, unknown>>("SELECT * FROM events ORDER BY ts, id", []).map(rowToEvent);
  const sess = () => rowToSession(store.get("SELECT * FROM sessions WHERE id = 's1'")!);
  return { store, ing, events, sess };
}

describe("checklist", () => {
  it("follows TodoWrite: done of total and the current item", async () => {
    const { ing, sess } = await setup();
    ing.ingestRaw(payload({ hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_use_id: "t1", tool_input: { todos: [
      { content: "Add login form", status: "completed", activeForm: "Adding login form" },
      { content: "Wire up auth", status: "in_progress", activeForm: "Wiring up auth" },
      { content: "Write tests", status: "pending", activeForm: "Writing tests" },
    ] } }), 1000);
    expect(sess().checklist).toMatchObject({ done: 1, total: 3, current: "Wiring up auth" });
  });
  it("follows task tools one item at a time", () => {
    let c = nextChecklist(null, { session_id: "s", hook_event_name: "PreToolUse", tool_name: "TaskCreate", tool_input: { subject: "Fix bug" } }, 1)!;
    c = nextChecklist(c, { session_id: "s", hook_event_name: "PreToolUse", tool_name: "TaskCreate", tool_input: { subject: "Ship" } }, 2)!;
    expect(c).toMatchObject({ done: 0, total: 2 });
    c = nextChecklist(c, { session_id: "s", hook_event_name: "TaskCompleted", task_subject: "Fix bug" }, 3)!;
    expect(c).toMatchObject({ done: 1, total: 2 });
  });
  it("ignores subagents' private lists and unrelated events", async () => {
    const { ing, sess } = await setup();
    ing.ingestRaw(payload({ hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_use_id: "t1", agent_id: "a", tool_input: { todos: [{ content: "x", status: "pending" }] } }), 1000);
    ing.ingestRaw(payload({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "t2", tool_input: { file_path: "/p/a.ts" } }), 2000);
    expect(sess().checklist).toBeNull();
  });
});

describe("turn summary: Claude finished vs verified", () => {
  const edit = (id: string, f: string, ts: number) => payload({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: id, tool_input: { file_path: f } });
  const bash = (id: string, cmd: string, fail = false) => payload({ hook_event_name: fail ? "PostToolUseFailure" : "PostToolUse", tool_name: "Bash", tool_use_id: id, tool_input: { command: cmd }, ...(fail ? { error: "Exit code 1" } : {}) });
  it("edits with no test after = unverified", async () => {
    const { ing, events } = await setup();
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "add x" }), 1000);
    ing.ingestRaw(edit("e1", "/p/a.ts", 0), 2000);
    ing.ingestRaw(payload({ hook_event_name: "Stop" }), 3000);
    expect(turnSummary(events())).toEqual({ steps: 1, files: 1, proof: "unverified", done: true });
  });
  it("tests passing after the last edit = verified; failing = failing", async () => {
    const { ing, events } = await setup();
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "add x" }), 1000);
    ing.ingestRaw(edit("e1", "/p/a.ts", 0), 2000);
    ing.ingestRaw(bash("b1", "npm test", true), 3000);
    expect(turnSummary(events())!.proof).toBe("failing");
    ing.ingestRaw(edit("e2", "/p/a.ts", 0), 4000);
    expect(turnSummary(events())!.proof).toBe("unverified");
    ing.ingestRaw(bash("b2", "npx vitest run"), 5000);
    expect(turnSummary(events())).toMatchObject({ files: 1, proof: "verified", done: false });
  });
  it("no file changes = nothing to verify", async () => {
    const { ing, events } = await setup();
    ing.ingestRaw(payload({ hook_event_name: "UserPromptSubmit", prompt: "explain" }), 1000);
    ing.ingestRaw(bash("b1", "ls"), 2000);
    expect(turnSummary(events())!.proof).toBeNull();
  });
});

describe("risk signals", () => {
  it("flags destructive commands and secret files, not routine cleanup", async () => {
    const { ing, events } = await setup();
    const run = (id: string, cmd: string, ts: number) => ing.ingestRaw(payload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: id, tool_input: { command: cmd } }), ts);
    run("1", "rm -rf node_modules && npm i", 1000);
    expect(risksIn(events())).toEqual([]);
    run("2", "git push --force origin main", 2000);
    ing.ingestRaw(payload({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "3", tool_input: { file_path: "/p/.env" } }), 3000);
    ing.ingestRaw(payload({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "4", tool_input: { file_path: "/p/.env.example" } }), 3500);
    const r = risksIn(events());
    expect(r.some((x) => /force-pushed/.test(x))).toBe(true);
    expect(r.some((x) => /secrets file \(\.env\)/.test(x))).toBe(true);
    expect(r.some((x) => /example/.test(x))).toBe(false);
  });
  it("tests failing → test files edited → tests pass is flagged for a look", async () => {
    const { ing, events } = await setup();
    ing.ingestRaw(payload({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "1", tool_input: { command: "npm test" }, error: "Exit code 1" }), 1000);
    ing.ingestRaw(payload({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "2", tool_input: { file_path: "/p/src/cart.test.ts" } }), 2000);
    ing.ingestRaw(payload({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "3", tool_input: { command: "npm test" } }), 3000);
    expect(risksIn(events())[0]).toMatch(/fixed the code, not the test/);
  });
});
