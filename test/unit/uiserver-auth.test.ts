import * as http from "http";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine";
import { UiServer } from "../../src/core/uiserver";
import { tmpDir } from "./helpers";

/** Phase B: the long-lived token never travels in a URL; launch links are one-time. */
describe("ui server auth", () => {
  let srv: UiServer;
  let engine: Engine;
  let base: string;
  beforeAll(async () => {
    engine = new Engine({ home: tmpDir(), inMemory: true, claudeSettingsFile: path.join(tmpDir(), "settings.json") });
    await engine.start();
    srv = new UiServer(engine, { media: tmpDir() });
    await srv.start();
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => {
    await srv.stop?.();
    engine.stop();
  });
  it("rejects the old ?t= token style and no-credential requests", async () => {
    expect((await fetch(`${base}/?t=${srv.token}`)).status).toBe(401);
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
  });
  it("a launch code works once and sets an HttpOnly cookie", async () => {
    const u = new URL(srv.url);
    const r = await fetch(`${base}/?c=${u.searchParams.get("c")}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await fetch(`${base}/?c=${u.searchParams.get("c")}`, { redirect: "manual" })).status).toBe(401); // used up
    const page = await fetch(`${base}/`, { headers: { cookie: cookie.split(";")[0]! } });
    expect(page.status).toBe(200);
  });
  it("the header token still works for the page's own API calls", async () => {
    expect((await fetch(`${base}/api/launch`, { method: "POST", headers: { "x-bp-token": srv.token } })).status).toBe(200);
  });
  it("refuses other Host names (DNS rebinding)", async () => {
    // fetch can't override Host, so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: srv.port, path: "/api/state", headers: { "x-bp-token": srv.token, host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("another local site can't drive BuildPilot: the cookie never works for actions, foreign origins are refused", async () => {
    const u = new URL(srv.url);
    const r = await fetch(`${base}/?c=${u.searchParams.get("c")}`, { redirect: "manual" });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).not.toContain(srv.token); // the cookie is a session nonce, not the token
    // cookie alone on POST (what a page on 127.0.0.1:3000 could send) → refused
    expect((await fetch(`${base}/api/msg`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ type: "copyHandoff" }) })).status).toBe(401);
    // even with the header, a foreign Origin is refused
    expect((await fetch(`${base}/api/msg`, { method: "POST", headers: { "x-bp-token": srv.token, origin: "http://127.0.0.1:3000", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    // the page can't be framed
    const page = await fetch(`${base}/`, { headers: { cookie } });
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });
});
