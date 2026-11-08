import * as http from "http";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine";
import { UiServer } from "../../src/core/uiserver";
import { makeRepo, tmpDir } from "./helpers";

let engine: Engine;
let srv: UiServer;
const req = (p: string, opts: { method?: string; body?: unknown; host?: string; token?: string | null } = {}) =>
  new Promise<{ code: number; body: string }>((resolve, reject) => {
    const u = new URL(srv.url);
    const r = http.request({ host: "127.0.0.1", port: Number(u.port), path: p, method: opts.method ?? "GET", headers: { host: opts.host ?? `127.0.0.1:${u.port}`, "content-type": "application/json", ...(opts.token === null ? {} : { "x-bp-token": opts.token ?? srv.token }) } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ code: res.statusCode ?? 0, body: b }));
    });
    r.on("error", reject);
    if (opts.body) r.end(JSON.stringify(opts.body));
    else r.end();
  });

beforeAll(async () => {
  const home = tmpDir();
  engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
  await engine.start();
  await engine.openProject(makeRepo({ "package.json": JSON.stringify({ name: "ui-app" }), "a.txt": "1" }));
  srv = new UiServer(engine, { media: path.join(__dirname, "../../media") });
  await srv.start();
});
afterAll(async () => {
  await srv.stop();
  engine.stop();
});

describe("standalone app server", () => {
  it("needs the token and a localhost Host header (other sites can't drive it)", async () => {
    expect((await req("/api/state", { token: null })).code).toBe(401);
    expect((await req("/api/state", { token: "wrong" })).code).toBe(401);
    expect((await req("/api/state", { host: "evil.example" })).code).toBe(403);
    expect((await req("/media/webview.js", { token: null })).code).toBe(200); // static page code is public, actions aren't
  });

  it("serves the page and live state", async () => {
    const page = await req(`/`);
    expect(page.code).toBe(200);
    expect(page.body).toContain("/media/webview.js");
    const st = JSON.parse((await req("/api/state")).body);
    expect(st.type).toBe("state");
    expect(st.settings).toMatchObject({ standalone: true });
    expect(st.page).toHaveProperty("limits");
  });

  it("writes prompts and reviews builds without VS Code", async () => {
    const r = JSON.parse((await req("/api/msg", { method: "POST", body: { type: "buildPrompt", goal: "feature", request: "Add a contact form that emails me", defer: true } })).body);
    expect(r.result.prompt.text).toMatch(/Settle these first/);
    const more = JSON.parse((await req("/api/msg", { method: "POST", body: { type: "more" } })).body);
    expect(more.result.show).toMatch(/bp audit/);
    const projects = JSON.parse((await req("/api/msg", { method: "POST", body: { type: "projects" } })).body);
    expect(projects.result.length).toBeGreaterThan(0);
  });

  it("refuses folders and files BuildPilot doesn't know (the page can't name arbitrary paths)", async () => {
    const post = async (body: unknown) => JSON.parse((await req("/api/msg", { method: "POST", body })).body).result;
    const other = makeRepo({ "secret.txt": "keep me" });
    expect((await post({ type: "undoFile", path: path.join(other, "secret.txt") })).flash).toMatch(/only puts back files a Claude session changed/);
    expect((await post({ type: "removeBuild", dir: other })).flash).toMatch(/isn't one of this project's side builds/);
    expect((await post({ type: "mergeBuild", dir: other, branch: "main" })).flash).toMatch(/isn't one of this project's side builds/);
    expect((await post({ type: "reviewBuild", dir: other, branch: "main" })).flash).toMatch(/isn't one of this project's side builds/);
    expect((await post({ type: "resumeBuild", id: "abcdef12-0000", cwd: other })).flash).toMatch(/Can't resume/);
    expect(await post({ type: "startFresh", cwd: other })).toBeNull();
  });

  it("undo is refused for a file a session only READ, allowed for one it edited", async () => {
    const post = async (body: unknown) => JSON.parse((await req("/api/msg", { method: "POST", body })).body).result;
    const root = engine.currentProject!.root;
    const f = path.join(root, "a.txt");
    (engine as unknown as { ingestor: { ingestRaw(r: string, ts: number): unknown } }).ingestor.ingestRaw(JSON.stringify({ session_id: "rd1", cwd: root, hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "r1", tool_input: { file_path: f } }), Date.now());
    expect((await post({ type: "undoFile", path: f })).flash).toMatch(/only puts back files a Claude session changed/);
    (engine as unknown as { ingestor: { ingestRaw(r: string, ts: number): unknown } }).ingestor.ingestRaw(JSON.stringify({ session_id: "rd1", cwd: root, hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "e1", tool_input: { file_path: f } }), Date.now() + 10);
    expect((await post({ type: "undoFile", path: f })).flash).toMatch(/Put back the last saved version/);
    expect((await post({ type: "whoChanged", query: "a.t" })).files.length).toBe(1);
  });
});
