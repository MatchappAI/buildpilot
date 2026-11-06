import { randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Alert, Engine } from "./engine";
import { pocketHtml } from "./pocket";
import { GOALS } from "./prompts";
import { GoalType } from "./types";

/**
 * Integration API: lets other tools (phone shortcuts, Raycast, Stream Deck, a companion app for
 * smart glasses, chat bots) ask BuildPilot "what's happening / what's next" and generate prompts.
 *
 * - OFF by default. Binds to 127.0.0.1 only, unless the user explicitly enables LAN access.
 * - Every request needs the bearer token from ~/.buildpilot/api-token (0600).
 * - Read-only + prompt generation. It cannot run commands, edit files, or start sessions.
 * - Responses contain summaries, never source code or secret values.
 */

export function loadOrCreateToken(home: string): string {
  const f = path.join(home, "api-token");
  try {
    const t = fs.readFileSync(f, "utf8").trim();
    if (t.length >= 32) return t;
  } catch {
    /* create below */
  }
  const t = randomBytes(24).toString("base64url");
  fs.writeFileSync(f, t + "\n", { mode: 0o600 });
  return t;
}

export function rotateToken(home: string): string {
  fs.rmSync(path.join(home, "api-token"), { force: true });
  return loadOrCreateToken(home);
}

function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ApiOptions {
  port: number;
  host: "127.0.0.1" | "0.0.0.0";
  token: string;
}

export class IntegrationApi {
  private server: http.Server | null = null;
  constructor(private readonly engine: Engine, private readonly opts: ApiOptions) {}

  get address(): string {
    return `http://${this.opts.host === "0.0.0.0" ? "<this-computer-ip>" : "127.0.0.1"}:${this.opts.port}`;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.on("error", reject);
      srv.listen(this.opts.port, this.opts.host, () => {
        this.server = srv;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private send(res: http.ServerResponse, code: number, body: unknown, type = "application/json"): void {
    const text = type === "application/json" ? JSON.stringify(body, null, 2) : String(body);
    res.writeHead(code, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(text);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // The Pocket page is static and contains no data; everything it shows is fetched with the token.
    if (req.method === "GET" && (req.url === "/pocket" || req.url === "/pocket/")) {
      const nonce = randomBytes(16).toString("base64");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      return void res.end(pocketHtml(nonce));
    }
    // No CORS headers: browsers on other origins can't read responses.
    if (!tokenOk(req.headers.authorization, this.opts.token)) return this.send(res, 401, { error: "unauthorized: send 'Authorization: Bearer <token>'" });
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET") {
        const st = this.engine.snapshot();
        switch (url.pathname) {
          case "/v1/brief": {
            const text = this.engine.brief(st);
            return url.searchParams.get("format") === "text" ? this.send(res, 200, text, "text/plain") : this.send(res, 200, { text });
          }
          case "/v1/status":
            return this.send(res, 200, {
              project: st.facts?.name ?? st.project?.name ?? null,
              stage: st.out.stage.stage,
              stageConfidence: st.out.stage.confidence,
              health: st.out.health,
              progress: st.out.progress,
              issues: st.out.issues.slice(0, 10).map((i) => ({ severity: i.severity, title: i.title, plain: i.plain })),
              next: st.out.next ? { title: st.out.next.title, why: st.out.next.why, severity: st.out.next.severity } : null,
              demo: st.demo,
            });
          case "/v1/sessions":
            return this.send(res, 200, [
              ...st.out.sessions.slice(0, 20).map((s) => ({ id: s.id, folder: st.facts?.name ?? st.project?.name ?? "", status: s.displayStatus, reason: s.displayReason, task: s.currentTask, lastEventAt: s.lastEventAt, errors: s.errorCount, needsYou: s.intervention, contextPct: st.live[s.id]?.contextPct ?? null })),
              ...st.elsewhere.map((s) => ({ id: s.id, folder: s.folder, status: s.status, reason: s.reason, task: s.task, lastEventAt: s.lastEventAt, errors: null, needsYou: s.status === "awaiting_approval" ? "Waiting for your approval in its terminal." : s.status === "blocked" ? "Needs your input." : null, contextPct: s.contextPct })),
            ]);
          case "/v1/next":
            return this.send(res, 200, st.out.next ? { title: st.out.next.title, why: st.out.next.why } : { title: null });
          case "/v1/goals":
            return this.send(res, 200, GOALS.map((g) => ({ id: g.id, label: g.label, plain: g.plain })));
          case "/v1/health":
            return this.send(res, 200, { ok: true });
        }
        return this.send(res, 404, { error: "not found" });
      }
      if (req.method === "POST" && url.pathname === "/v1/prompt") {
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c.toString("utf8");
          if (body.length > 20_000) req.destroy();
        });
        req.on("end", () => {
          let parsed: { goal?: string; request?: string };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return this.send(res, 400, { error: "invalid JSON" });
          }
          const goalId = (GOALS.some((g) => g.id === parsed.goal) ? parsed.goal : "feature") as GoalType;
          if (typeof parsed.request !== "string" || !parsed.request.trim()) return this.send(res, 400, { error: "request (string) is required" });
          const p = this.engine.prompt({ goal: goalId, request: parsed.request });
          return this.send(res, 200, { prompt: p.text, missingInfo: p.missingInfo, assumptions: p.assumptions });
        });
        return;
      }
      return this.send(res, 405, { error: "method not allowed" });
    } catch (e) {
      return this.send(res, 500, { error: (e as Error).message });
    }
  }
}

/**
 * Outbound notifications for meaningful events only (approval needed, failure, loop, conflict).
 * Works with ntfy (phone push, which smart glasses paired to the phone can announce), Slack/Discord-style
 * incoming webhooks, or any JSON webhook. Opt-in; the URL is user-provided.
 */
export async function sendWebhook(url: string, a: Alert, projectName: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))) throw new Error("Webhook URL must use https");
  const short = `${a.title}${a.message ? `: ${a.message}` : ""}`.slice(0, 300);
  let init: RequestInit;
  if (/(^|\.)ntfy\.sh$/.test(u.hostname) || u.searchParams.has("ntfy")) {
    init = { method: "POST", body: short, headers: { Title: `BuildPilot · ${projectName}`.slice(0, 100), Priority: a.level === "error" ? "high" : "default", Tags: a.level === "error" ? "warning" : "robot" } };
  } else if (/hooks\.slack\.com$/.test(u.hostname)) {
    init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `*BuildPilot · ${projectName}*\n${short}` }) };
  } else if (/discord(app)?\.com$/.test(u.hostname)) {
    init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `**BuildPilot · ${projectName}**\n${short}` }) };
  } else {
    init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "buildpilot", project: projectName, level: a.level, title: a.title, message: a.message, text: short }) };
  }
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}
