import { createHash, randomUUID } from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { analyzeRepo, listFiles, RepoFacts, scanSecrets, SecretFinding } from "./analyzer";
import { Store } from "./db";
import { DoctorCheck, runDoctor } from "./doctor";
import { changeSet, Checkpoint, createCheckpoint, gitAvailable, isRepo, listCheckpoints, recentCommits, Commit, run } from "./git";
import { AuditResult, detectAppUrl, detectDrift, findBrowser, runAudit, VisualCheck, visualCheck } from "./checks";
import { buildpilotHome, claudeSettingsPath, ensureHome, hookStatus, HookStatus, LiveStatus, readLiveStatus, statuslineStatus, StatuslineStatus } from "./hooks";
import { Ingestor, rowToEvent, rowToSession, SpoolReader } from "./ingest";
import { buildClaudeMd, buildHandoff } from "./memory";
import { buildPrompt, BuiltPrompt, PromptOptions, relevantFiles } from "./prompts";
import { gate, Paywall, recordUse } from "./license";
import { clip } from "./redact";
import { deriveDisplayStatus, lastTestRun, normalizeError, supervise, SupervisorOutput } from "./supervisor";
import { readUsage } from "./transcript";
import { ChangeSet, Decision, HookEvent, Project, Requirement, Session, SessionStatus, TestRun, UsageSnapshot } from "./types";

export interface EngineOptions {
  home?: string;
  inMemory?: boolean;
  claudeSettingsFile?: string;
  /** Terminal glance: drain the spool once, no file watchers, no tool probing. */
  light?: boolean;
}

export interface Metric {
  key: string;
  label: string;
  value: string; // display value, "—" when unknown
  detail: string;
  why: string; // why this number matters (tooltip / screen reader)
  tone: "good" | "warn" | "bad" | "neutral";
  confidence: "verified" | "unknown" | "estimate";
  tab?: "overview" | "sessions" | "supervisor" | "prompts" | "memory" | "connect";
}

export interface Alert {
  key: string;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  sessionId?: string;
}

export interface UiState {
  generatedAt: number;
  project: Project | null;
  analyzing: boolean;
  facts: RepoFacts | null;
  changes: ChangeSet | null;
  commits: Commit[];
  checkpoints: Checkpoint[];
  doctor: DoctorCheck[];
  secrets: SecretFinding[] | null;
  out: SupervisorOutput;
  resolved: { key: string; title: string; resolvedAt: number }[];
  requirements: Requirement[];
  decisions: Decision[];
  testRuns: TestRun[];
  usage: Record<string, UsageSnapshot>;
  live: Record<string, LiveStatus | null>;
  audit: AuditResult | null;
  visual: VisualCheck | null;
  appUrl: { url: string | null; basis: string };
  browserFound: boolean;
  drift: string[];
  hooks: HookStatus;
  statusline: StatuslineStatus;
  integration: { claudeInstalled: boolean | null; claudeVersion: string | null; gitAvailable: boolean | null; spool: SpoolReader["stats"]; otherProjectSessions: number };
  /** Active sessions in OTHER folders: mission control across all your projects (observed only). */
  metrics: Metric[];
  elsewhere: { id: string; folder: string; cwd: string; status: SessionStatus; reason: string; task: string | null; lastEventAt: number; contextPct: number | null }[];
  notes: { goal: string; preferences: string };
  errors: string[];
  runningScript: string | null;
  demo: boolean;
}

/** Canonicalize a path (resolve symlinks) when it exists; fall back to path.resolve. */
export function realpath(p: string): string {
  try {
    return fs.realpathSync.native(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

export const projectIdFor = (root: string): string => createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);

export class Engine extends EventEmitter {
  readonly home: string;
  store!: Store;
  private ingestor!: Ingestor;
  private spool: SpoolReader | null = null;
  private project: Project | null = null;
  private facts: RepoFacts | null = null;
  private changes: ChangeSet | null = null;
  private commits: Commit[] = [];
  private checkpoints: Checkpoint[] = [];
  private doctor: DoctorCheck[] = [];
  private secrets: SecretFinding[] | null = null;
  private files: string[] = [];
  private analyzing = false;
  private errors: string[] = [];
  private claude: { installed: boolean | null; version: string | null } = { installed: null, version: null };
  private gitOk: boolean | null = null;
  private nodeVersion: string | null = null;
  private usageCache = new Map<string, { mtime: number; usage: UsageSnapshot }>();
  private lastAlertKeys = new Map<string, number>();
  private runningScript: string | null = null;
  appUrlOverride = "";
  private settingsFile: string;
  private changeTimer: NodeJS.Timeout | null = null;
  demo = false;

  constructor(private readonly opts: EngineOptions = {}) {
    super();
    this.home = opts.home ?? buildpilotHome();
    this.settingsFile = opts.claudeSettingsFile ?? claudeSettingsPath("user");
  }

  async start(): Promise<void> {
    ensureHome(this.home);
    this.store = await Store.open(this.opts.inMemory ? null : path.join(this.home, "buildpilot.db"));
    this.ingestor = new Ingestor(this.store, (cwd) => this.resolveProject(cwd));
    this.spool = new SpoolReader(path.join(this.home, "spool"), this.ingestor, (n) => this.onIngest(n));
    if (this.opts.light) {
      this.spool.drain();
      return;
    }
    this.store.prune();
    this.spool.start();
    void this.probeTools();
  }

  stop(): void {
    this.spool?.stop();
    this.spool = null;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.store?.close();
  }

  /** Coalesce bursts of hook events into one UI update. */
  private onIngest(_n: number): void {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit("changed");
      this.checkAlerts();
    }, 300);
  }

  drainNow(): number {
    return this.spool?.drain() ?? 0;
  }

  setClaudeSettingsFile(f: string): void {
    this.settingsFile = f;
  }

  get claudeSettingsFile(): string {
    return this.settingsFile;
  }

  private async probeTools(): Promise<void> {
    const c = await run("claude", ["--version"], this.home, { timeoutMs: 8000 });
    this.claude = { installed: c.code === 0, version: c.code === 0 ? clip(c.stdout.trim(), 60) : null };
    this.gitOk = await gitAvailable();
    const n = await run("node", ["--version"], this.home, { timeoutMs: 5000 });
    this.nodeVersion = n.code === 0 ? n.stdout.trim() : null;
    this.emit("changed");
  }

  // ---------- projects ----------

  resolveProject(cwd: string): string | null {
    const abs = realpath(cwd);
    const projects = this.store.all<{ id: string; root: string }>("SELECT id, root FROM projects");
    let best: { id: string; len: number } | null = null;
    for (const p of projects) {
      if (abs === p.root || abs.startsWith(p.root + path.sep)) {
        if (!best || p.root.length > best.len) best = { id: p.id, len: p.root.length };
      }
    }
    return best?.id ?? null;
  }

  async openProject(root: string): Promise<Project> {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a folder: ${root}`);
    // Canonical path: Claude Code reports real paths (e.g. /private/var on macOS, not the /var symlink).
    const abs = realpath(root);
    const id = projectIdFor(abs);
    if (!this.store.get("SELECT 1 AS x FROM projects WHERE id = ?", [id])) {
      this.store.run("INSERT INTO projects (id, root, name, created_at) VALUES (?, ?, ?, ?)", [id, abs, path.basename(abs), Date.now()]);
    }
    // attach previously unassociated sessions that ran inside this folder
    this.store.run("UPDATE sessions SET project_id = ? WHERE project_id IS NULL AND (cwd = ? OR cwd LIKE ?)", [id, abs, abs + path.sep + "%"]);
    this.project = this.getProject(id)!;
    this.facts = null;
    this.changes = null;
    this.secrets = null;
    this.doctor = [];
    this.emit("changed");
    await this.analyze();
    return this.project;
  }

  getProject(id: string): Project | null {
    const r = this.store.get<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [id]);
    if (!r) return null;
    return { id: String(r.id), root: String(r.root), name: String(r.name), createdAt: Number(r.created_at), lastAnalyzedAt: r.last_analyzed_at == null ? null : Number(r.last_analyzed_at) };
  }

  get currentProject(): Project | null {
    return this.project;
  }

  async analyze(): Promise<void> {
    const p = this.project;
    if (!p || this.analyzing) return;
    this.analyzing = true;
    this.errors = [];
    this.emit("changed");
    try {
      this.facts = await analyzeRepo(p.root);
      this.files = (await listFiles(p.root)).files;
      if (await isRepo(p.root)) {
        this.changes = await changeSet(p.root);
        this.commits = await recentCommits(p.root);
        this.checkpoints = await listCheckpoints(p.root);
      } else {
        this.changes = null;
        this.commits = [];
        this.checkpoints = [];
      }
      if (!this.nodeVersion) {
        const n = await run("node", ["--version"], p.root, { timeoutMs: 5000 });
        this.nodeVersion = n.code === 0 ? n.stdout.trim() : null;
      }
      this.doctor = runDoctor(this.facts, this.nodeVersion);
      this.secrets = await scanSecrets(p.root);
      this.store.run("UPDATE projects SET last_analyzed_at = ? WHERE id = ?", [Date.now(), p.id]);
      this.syncRequirementVerification();
    } catch (e) {
      this.errors.push(`Analysis failed: ${(e as Error).message}`);
    } finally {
      this.analyzing = false;
      this.emit("changed");
      this.checkAlerts();
    }
  }

  /** Cheap refresh of git state only (called on file save). */
  async refreshGit(): Promise<void> {
    const p = this.project;
    if (!p || !this.facts?.isGit) return;
    this.changes = await changeSet(p.root);
    this.emit("changed");
  }

  // ---------- sessions ----------

  sessionsForProject(projectId: string | null, limit = 30): Session[] {
    const rows = projectId
      ? this.store.all<Record<string, unknown>>("SELECT * FROM sessions WHERE project_id = ? ORDER BY last_event_at DESC LIMIT ?", [projectId, limit])
      : this.store.all<Record<string, unknown>>("SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT ?", [limit]);
    return rows.map(rowToSession);
  }

  eventsFor(sessionId: string, limit = 400): HookEvent[] {
    return this.store
      .all<Record<string, unknown>>("SELECT * FROM (SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts ASC, id ASC", [sessionId, limit])
      .map(rowToEvent);
  }

  usageFor(s: Session): UsageSnapshot {
    const none: UsageSnapshot = { model: s.model, lastTurnInputTokens: null, totalOutputTokens: null, assistantTurns: 0, contextWindowEstimate: null, source: "none" };
    if (!s.transcriptPath) return none;
    let mtime = 0;
    try {
      mtime = fs.statSync(s.transcriptPath).mtimeMs;
    } catch {
      return none;
    }
    const c = this.usageCache.get(s.id);
    if (c && c.mtime === mtime) return c.usage;
    const usage = readUsage(s.transcriptPath);
    this.usageCache.set(s.id, { mtime, usage });
    return usage;
  }

  // ---------- memory ----------

  requirements(): Requirement[] {
    if (!this.project) return [];
    return this.store
      .all<Record<string, unknown>>("SELECT * FROM requirements WHERE project_id = ? ORDER BY created_at ASC", [this.project.id])
      .map((r) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        title: String(r.title),
        acceptance: String(r.acceptance),
        status: r.status as Requirement["status"],
        evidence: r.evidence as Requirement["evidence"],
        evidenceNote: String(r.evidence_note),
        source: r.source as Requirement["source"],
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }));
  }

  addRequirement(title: string, acceptance = "", source: Requirement["source"] = "user", status: Requirement["status"] = "todo"): void {
    if (!this.project) throw new Error("Open a project first");
    const t = clip(title.trim(), 200);
    if (!t) return;
    const now = Date.now();
    this.store.run("INSERT INTO requirements (id, project_id, title, acceptance, status, evidence, evidence_note, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'unknown', '', ?, ?, ?)", [randomUUID(), this.project.id, t, clip(acceptance.trim(), 400), status, source, now, now]);
    this.emit("changed");
  }

  updateRequirement(id: string, patch: Partial<Pick<Requirement, "title" | "acceptance" | "status" | "evidence" | "evidenceNote">>): void {
    const sets: string[] = [];
    const params: (string | number)[] = [];
    const map: Record<string, string> = { title: "title", acceptance: "acceptance", status: "status", evidence: "evidence", evidenceNote: "evidence_note" };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !map[k]) continue;
      sets.push(`${map[k]} = ?`);
      params.push(clip(String(v), 400));
    }
    // Marking done by hand = "unverified" until evidence (a passing test run) exists.
    if (patch.status === "done" && patch.evidence === undefined) {
      const lastTest = lastTestRun(this.testRuns());
      sets.push("evidence = ?", "evidence_note = ?");
      if (lastTest?.passed) params.push("verified", `tests passed: ${lastTest.command} at ${new Date(lastTest.startedAt).toLocaleString()}`);
      else params.push("unverified", "marked done by you; no passing test run yet");
    }
    if (patch.status && patch.status !== "done") sets.push("evidence = 'unknown'", "evidence_note = ''");
    if (!sets.length) return;
    sets.push("updated_at = ?");
    params.push(Date.now(), id);
    this.store.run(`UPDATE requirements SET ${sets.join(", ")} WHERE id = ?`, params);
    this.emit("changed");
  }

  deleteRequirement(id: string): void {
    this.store.run("DELETE FROM requirements WHERE id = ?", [id]);
    this.emit("changed");
  }

  /** Done-but-unverified requirements become verified once a full test run passes after they were marked done. */
  private syncRequirementVerification(): void {
    if (!this.project) return;
    const last = lastTestRun(this.testRuns());
    if (!last?.passed) return;
    this.store.run(
      "UPDATE requirements SET evidence = 'verified', evidence_note = ? WHERE project_id = ? AND status = 'done' AND evidence = 'unverified' AND updated_at <= ?",
      [`tests passed: ${last.command} at ${new Date(last.startedAt).toLocaleString()}`, this.project.id, last.startedAt],
    );
  }

  importChecklist(): number {
    if (!this.project || !this.facts) return 0;
    const existing = new Set(this.requirements().map((r) => r.title.toLowerCase()));
    let n = 0;
    for (const c of this.facts.checklistItems) {
      if (existing.has(c.text.toLowerCase())) continue;
      this.addRequirement(c.text, "", "imported", c.done ? "done" : "todo");
      n++;
    }
    return n;
  }

  decisions(): Decision[] {
    if (!this.project) return [];
    return this.store.all<Record<string, unknown>>("SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC", [this.project.id]).map((r) => ({ id: Number(r.id), projectId: String(r.project_id), title: String(r.title), detail: String(r.detail), createdAt: Number(r.created_at) }));
  }

  addDecision(title: string, detail = ""): void {
    if (!this.project) throw new Error("Open a project first");
    this.store.run("INSERT INTO decisions (project_id, title, detail, created_at) VALUES (?, ?, ?, ?)", [this.project.id, clip(title, 200), clip(detail, 1000), Date.now()]);
    this.emit("changed");
  }

  deleteDecision(id: number): void {
    this.store.run("DELETE FROM decisions WHERE id = ?", [id]);
    this.emit("changed");
  }

  note(key: string): string {
    if (!this.project) return "";
    return String(this.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = ?", [this.project.id, key]) ?? "");
  }

  setNote(key: string, value: string): void {
    if (!this.project) throw new Error("Open a project first");
    this.store.run("INSERT INTO notes (project_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [this.project.id, key, clip(value, 2000), Date.now()]);
    this.emit("changed");
  }

  dismiss(key: string, hours = 24): void {
    if (!this.project) return;
    const until = Date.now() + hours * 3600_000;
    this.store.run("INSERT INTO rec_history (project_id, key, first_seen, last_seen, dismissed_until) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET dismissed_until = excluded.dismissed_until", [this.project.id, key, Date.now(), Date.now(), until]);
    this.emit("changed");
  }

  private dismissed(): Set<string> {
    if (!this.project) return new Set();
    return new Set(this.store.all<{ key: string }>("SELECT key FROM rec_history WHERE project_id = ? AND dismissed_until > ?", [this.project.id, Date.now()]).map((r) => r.key));
  }

  testRuns(limit = 20): TestRun[] {
    if (!this.project) return [];
    return this.store.all<Record<string, unknown>>("SELECT * FROM test_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?", [this.project.id, limit]).map((r) => ({
      id: Number(r.id),
      projectId: String(r.project_id),
      command: String(r.command),
      startedAt: Number(r.started_at),
      durationMs: Number(r.duration_ms),
      exitCode: r.exit_code == null ? null : Number(r.exit_code),
      passed: Number(r.passed) === 1,
      outputTail: String(r.output_tail),
      source: r.source as TestRun["source"],
    }));
  }

  // ---------- approved actions ----------

  /** Runs a package.json script by NAME only (or install). Caller must have user approval. */
  async runScript(name: string): Promise<TestRun> {
    const p = this.project;
    if (!p || !this.facts) throw new Error("Open a project first");
    if (this.runningScript) throw new Error(`Already running ${this.runningScript}`);
    const pm = this.facts.packageManager && ["npm", "pnpm", "yarn", "bun"].includes(this.facts.packageManager) ? this.facts.packageManager : "npm";
    let args: string[];
    if (name === "install") args = ["install"];
    else {
      if (!Object.prototype.hasOwnProperty.call(this.facts.scripts, name)) throw new Error(`No script named "${name}" in package.json`);
      args = ["run", name];
    }
    const bin = process.platform === "win32" ? `${pm}.cmd` : pm;
    const command = `${pm} ${args.join(" ")}`;
    this.runningScript = command;
    this.store.run("INSERT INTO approvals (project_id, action, detail, approved_at) VALUES (?, 'run_script', ?, ?)", [p.id, command, Date.now()]);
    this.emit("changed");
    const started = Date.now();
    const r = await run(bin, args, p.root, { timeoutMs: name === "install" ? 10 * 60_000 : 5 * 60_000, env: { CI: "1", FORCE_COLOR: "0" }, maxBuffer: 32 * 1024 * 1024 });
    const tail = clip((r.stdout + "\n" + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(-60).join("\n"), 6000);
    this.store.run("INSERT INTO test_runs (project_id, command, started_at, duration_ms, exit_code, passed, output_tail, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'buildpilot')", [p.id, command, started, Date.now() - started, r.code, r.code === 0 ? 1 : 0, tail]);
    this.store.run("UPDATE approvals SET outcome = ? WHERE id = (SELECT MAX(id) FROM approvals WHERE project_id = ?)", [r.code === 0 ? "passed" : `failed (exit ${r.code})`, p.id]);
    this.runningScript = null;
    await this.analyze();
    return this.testRuns(1)[0]!;
  }

  async checkpoint(label: string): Promise<Checkpoint> {
    const p = this.project;
    if (!p) throw new Error("Open a project first");
    const cp = await createCheckpoint(p.root, label);
    this.store.run("INSERT INTO approvals (project_id, action, detail, approved_at, outcome) VALUES (?, 'checkpoint', ?, ?, ?)", [p.id, label, Date.now(), cp.sha.slice(0, 10)]);
    this.checkpoints = await listCheckpoints(p.root);
    this.emit("changed");
    return cp;
  }

  private jsonNote<T>(key: string): T | null {
    const v = this.note(key);
    if (!v) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  private setJsonNote(key: string, value: unknown): void {
    if (!this.project) return;
    // stored directly (not via setNote) so long JSON isn't clipped
    this.store.run("INSERT INTO notes (project_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [this.project.id, key, JSON.stringify(value), Date.now()]);
    this.emit("changed");
  }

  /** Prompts typed into Claude Code sessions for this project over the last 7 days (already redacted). */
  recentPrompts(sessions: Session[], now = Date.now()): string[] {
    const out: string[] = [];
    for (const s of sessions) {
      if (s.id.startsWith("demo-")) continue;
      for (const r of this.store.all<{ summary: string }>("SELECT summary FROM events WHERE session_id = ? AND hook_event = 'UserPromptSubmit' AND ts > ? ORDER BY ts DESC LIMIT 20", [s.id, now - 7 * 86400_000])) {
        out.push(r.summary.replace(/^Prompt: /, ""));
      }
    }
    return out.slice(0, 60);
  }

  /** Approved action: dependency audit (npm audit needs network to the npm registry). */
  async audit(): Promise<AuditResult> {
    if (!this.project || !this.facts) throw new Error("Open a project first");
    this.store.run("INSERT INTO approvals (project_id, action, detail, approved_at) VALUES (?, 'audit', 'dependency audit', ?)", [this.project.id, Date.now()]);
    const r = await runAudit(this.facts);
    this.setJsonNote("audit", r);
    return r;
  }

  /** Approved action: open the user's local app headlessly, check it and take a screenshot. */
  async visualCheck(url: string): Promise<VisualCheck> {
    if (!this.project) throw new Error("Open a project first");
    const r = await visualCheck(url, path.join(this.home, "visual", this.project.id));
    this.setJsonNote("visual", r);
    return r;
  }

  /** Approved action: a separate working copy (git worktree) on a new branch, so a session can't collide with another. */
  async createWorktree(label: string): Promise<{ dir: string; branch: string }> {
    const p = this.project;
    if (!p) throw new Error("Open a project first");
    const head = await run("git", ["rev-parse", "--verify", "-q", "HEAD"], p.root);
    if (head.code !== 0) throw new Error("Worktrees need at least one commit. Commit your work first.");
    const ts = Date.now();
    const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "build";
    // Readable names: invoice-app-checkout / bp/checkout, with -2, -3… only when taken.
    const branches = (await run("git", ["branch", "--list", "--format=%(refname:short)"], p.root)).stdout.split("\n").map((x) => x.trim());
    let n = 1;
    const name = () => (n === 1 ? safe : `${safe}-${n}`);
    while (branches.includes(`bp/${name()}`) || fs.existsSync(path.join(path.dirname(p.root), `${path.basename(p.root)}-${name()}`))) n++;
    const branch = `bp/${name()}`;
    const dir = path.join(path.dirname(p.root), `${path.basename(p.root)}-${name()}`);
    const r = await run("git", ["worktree", "add", "-b", branch, dir], p.root, { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "git worktree add failed");
    // A fresh copy has no local secrets: copy untracked .env files so the new build can run (same machine, same permissions).
    for (const f of fs.readdirSync(p.root)) {
      if (!/^\.env(\..+)?$/.test(f) || f === ".env.example") continue;
      const src = path.join(p.root, f);
      try {
        if (fs.statSync(src).isFile() && !fs.existsSync(path.join(dir, f))) fs.copyFileSync(src, path.join(dir, f));
      } catch {
        /* best effort */
      }
    }
    this.store.run("INSERT INTO approvals (project_id, action, detail, approved_at, outcome) VALUES (?, 'worktree', ?, ?, ?)", [p.id, dir, ts, branch]);
    this.addDecision(`Separate worktree for parallel work: ${path.basename(dir)}`, `Branch ${branch}. Merge it back when that session's work is done.`);
    return { dir, branch };
  }

  /** BuildPilot-made builds (worktrees on bp/ or buildpilot/ branches) for this project. */
  async extraBuilds(): Promise<{ dir: string; branch: string; dirty: boolean }[]> {
    const p = this.project;
    if (!p) return [];
    const out = (await run("git", ["worktree", "list", "--porcelain"], p.root)).stdout;
    const items: { dir: string; branch: string; dirty: boolean }[] = [];
    for (const block of out.split("\n\n")) {
      const dir = /^worktree (.+)$/m.exec(block)?.[1];
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
      if (!dir || !branch || dir === p.root || !/^(bp|buildpilot)\//.test(branch)) continue;
      const st = await run("git", ["status", "--porcelain"], dir);
      items.push({ dir, branch, dirty: st.stdout.trim().length > 0 });
    }
    return items;
  }

  /** Removes a finished build's folder. Never deletes uncommitted work (git refuses dirty worktrees) and keeps the branch. */
  async removeBuild(dir: string): Promise<void> {
    const p = this.project;
    if (!p) throw new Error("Open a project first");
    const r = await run("git", ["worktree", "remove", dir], p.root, { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(/modified or untracked/.test(r.stderr) ? "It has unsaved changes. Commit or discard them in that folder first." : r.stderr.trim() || "git worktree remove failed");
  }

  /** Redacted, compact digest of a session for an (opt-in) AI explanation. No file contents. */
  sessionDigest(sessionId: string): string {
    const evs = this.eventsFor(sessionId, 120);
    const lines = evs.map((e) => `${new Date(e.ts).toISOString().slice(11, 16)} ${e.hookEvent}: ${e.summary}${e.isError && e.errorText ? ` | error: ${e.errorText.split("\n").slice(0, 2).join(" ")}` : ""}`);
    return lines.join("\n").slice(-12_000);
  }

  // ---------- snapshot ----------

  snapshot(now = Date.now()): UiState {
    const p = this.project;
    const sessions = p ? this.sessionsForProject(p.id) : [];
    const eventsBySession = new Map<string, HookEvent[]>();
    for (const s of sessions.slice(0, 12)) eventsBySession.set(s.id, this.eventsFor(s.id));
    const testRuns = this.testRuns();
    const requirements = this.requirements();
    let hooks = hookStatus(this.settingsFile, this.home);
    if (!hooks.installed && p) {
      // Project-scoped installs count too (.claude/settings.local.json or .claude/settings.json).
      for (const f of [claudeSettingsPath("project", p.root), path.join(p.root, ".claude", "settings.json")]) {
        const h = hookStatus(f, this.home);
        if (h.installed) {
          hooks = h;
          break;
        }
      }
    }
    const lastCp = this.checkpoints[0];
    const live: Record<string, LiveStatus | null> = {};
    for (const s of sessions.slice(0, 12)) live[s.id] = readLiveStatus(s.id, this.home);
    const audit = this.jsonNote<AuditResult>("audit");
    const visual = this.jsonNote<VisualCheck>("visual");
    const prompts = this.recentPrompts(sessions, now);
    const drift = detectDrift(prompts, requirements);
    const out = supervise({
      now,
      facts: this.facts,
      changes: this.changes,
      sessions,
      eventsBySession,
      testRuns,
      requirements,
      doctor: this.doctor,
      secrets: this.secrets,
      hooksInstalled: hooks.installed,
      claudeInstalled: this.claude.installed,
      dismissed: this.dismissed(),
      hasCheckpointSinceChanges: !!lastCp && now - lastCp.ts < 2 * 3600_000,
      live,
      audit,
      drift,
      visual,
    });
    const resolved = this.trackRecommendations(out, now);
    if (p && this.facts) {
      const summary = JSON.stringify({ next: out.next?.title ?? null, health: out.health.label, stage: out.stage.stage, name: this.facts.name });
      if (summary !== this.lastSummary) {
        this.lastSummary = summary;
        this.store.run("INSERT INTO notes (project_id, key, value, updated_at) VALUES (?, 'summary', ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [p.id, summary, now]);
      }
    }
    const usage: Record<string, UsageSnapshot> = {};
    for (const s of sessions.slice(0, 12)) usage[s.id] = this.usageFor(s);
    const elsewhere = this.store
      .all<Record<string, unknown>>("SELECT * FROM sessions WHERE (project_id IS NULL OR project_id != ?) AND ended_at IS NULL AND last_event_at > ? AND id NOT LIKE 'demo-%' ORDER BY last_event_at DESC LIMIT 12", [p?.id ?? "", now - 3 * 3600_000])
      .map(rowToSession)
      .map((s) => {
        const d = deriveDisplayStatus(s, now);
        return { id: s.id, folder: path.basename(s.cwd) || s.cwd, cwd: s.cwd, status: d.status, reason: d.reason, task: s.currentTask, lastEventAt: s.lastEventAt, contextPct: readLiveStatus(s.id, this.home)?.contextPct ?? null };
      });
    const otherProjectSessions = Number(this.store?.scalar("SELECT COUNT(*) FROM sessions WHERE (project_id IS NULL OR project_id != ?) AND ended_at IS NULL AND last_event_at > ?", [p?.id ?? "", now - 3600_000]) ?? 0);
    return {
      generatedAt: now,
      project: p,
      analyzing: this.analyzing,
      facts: this.facts,
      changes: this.changes,
      commits: this.commits,
      checkpoints: this.checkpoints,
      doctor: this.doctor,
      secrets: this.secrets,
      out,
      resolved,
      requirements,
      decisions: this.decisions(),
      testRuns,
      usage,
      live,
      audit,
      visual,
      appUrl: this.facts ? detectAppUrl(this.facts, this.appUrlOverride) : { url: null, basis: "not analyzed" },
      browserFound: !!findBrowser(),
      drift,
      hooks,
      statusline: statuslineStatus(this.settingsFile, this.home),
      integration: { claudeInstalled: this.claude.installed, claudeVersion: this.claude.version, gitAvailable: this.gitOk, spool: this.spool?.stats ?? { accepted: 0, duplicates: 0, rejected: 0, lastEventAt: 0 }, otherProjectSessions },
      elsewhere,
      metrics: this.metrics(p?.id ?? null, sessions, live, testRuns, now, out),
      notes: { goal: this.note("goal"), preferences: this.note("preferences") },
      errors: this.errors,
      runningScript: this.runningScript,
      demo: this.demo || this.hasDemoData(),
    };
  }

  prompt(opts: PromptOptions, state = this.snapshot()): BuiltPrompt {
    return buildPrompt(opts, {
      facts: state.facts,
      changes: state.changes,
      requirements: state.requirements,
      issues: state.out.issues,
      lastTest: lastTestRun(state.testRuns) ?? null,
      decisions: state.decisions,
      preferences: state.notes.preferences,
      handoff: opts.goal === "handoff" ? this.handoff(state) : undefined,
      relevantFiles: relevantFiles(opts.request, this.files),
    });
  }

  /** Prompt Studio entry point for users: free limit applies; licensed users are never counted. */
  gatedPrompt(opts: PromptOptions, state = this.snapshot(), record = true): { prompt: BuiltPrompt; remaining: number | null } | { paywall: Paywall } {
    const g = gate(this.home);
    if (!g.allowed) return { paywall: g.paywall };
    const prompt = this.prompt(opts, state);
    return { prompt, remaining: record ? recordUse(this.home) : g.remaining };
  }

  handoff(state = this.snapshot()): string {
    const attempted: string[] = [];
    for (const s of state.out.sessions.slice(0, 5)) {
      const counts = new Map<string, number>();
      for (const e of this.eventsFor(s.id)) if (e.isError && e.errorText) counts.set(normalizeError(e.errorText), (counts.get(normalizeError(e.errorText)) ?? 0) + 1);
      for (const [k, n] of counts) if (n >= 2) attempted.push(k);
    }
    return buildHandoff({
      projectName: state.project?.name ?? "project",
      goal: state.notes.goal,
      preferences: state.notes.preferences,
      facts: state.facts,
      requirements: state.requirements,
      decisions: state.decisions,
      testRuns: state.testRuns,
      out: state.out,
      sessions: state.out.sessions,
      attemptedFixes: attempted,
      now: state.generatedAt,
    });
  }

  claudeMdDraft(): string | null {
    if (!this.facts) return null;
    return buildClaudeMd(this.facts, this.note("goal"), this.decisions(), this.note("preferences"));
  }

  /** "Brief" for voice/glasses/notifications: 1–3 short sentences, no markdown. */
  brief(state = this.snapshot()): string {
    if (!state.project) return "BuildPilot has no project open.";
    const name = state.facts?.name ?? state.project.name;
    const parts: string[] = [];
    const active = state.out.sessions.filter((s) => !s.endedAt && state.generatedAt - s.lastEventAt < 3600_000);
    const waiting = active.filter((s) => s.displayStatus === "awaiting_approval" || s.displayStatus === "blocked");
    const running = active.filter((s) => s.displayStatus === "running");
    if (active.length === 0) parts.push(`${name}: no active Claude sessions.`);
    else parts.push(`${name}: ${running.length} session${running.length === 1 ? "" : "s"} working${waiting.length ? `, ${waiting.length} waiting for you` : ""}.`);
    const top = state.out.issues[0];
    if (top && (top.severity === "blocker" || top.severity === "high")) parts.push(`Problem: ${top.title}.`);
    const waitingElsewhere = state.elsewhere.filter((s) => s.status === "awaiting_approval" || s.status === "blocked");
    if (waitingElsewhere.length) parts.push(`Also waiting for you in ${[...new Set(waitingElsewhere.map((s) => s.folder))].join(", ")}.`);
    if (state.out.next) parts.push(`Next: ${state.out.next.title}.`);
    return parts.join(" ");
  }

  private recTitles = new Map<string, string>();
  private lastSummary = "";

  /** At-a-glance numbers. Every one is observed or explicitly marked unknown/estimate, and each says why it matters. */
  metrics(projectId: string | null, sessions: Session[], live: Record<string, LiveStatus | null>, runs: TestRun[], now: number, out: SupervisorOutput): Metric[] {
    const m: Metric[] = [];
    // Same set the Sessions tab counts (demo sessions only exist while the DEMO banner is shown).
    const active = sessions.filter((s) => !s.endedAt && now - s.lastEventAt < 3600_000);
    const demo = active.some((s) => s.id.startsWith("demo-")) ? " (demo)" : "";
    const views = out.sessions.filter((s) => active.some((a) => a.id === s.id));
    const waiting = views.filter((s) => s.displayStatus === "awaiting_approval" || s.displayStatus === "blocked").length;
    const working = views.filter((s) => s.displayStatus === "running").length;
    m.push({ key: "sessions", label: "Sessions", value: active.length ? `${working} working` : "0", detail: (waiting ? `${waiting} waiting for you` : active.length ? `${active.length} active` : "none active") + demo, why: "How many Claude Code agents are working on this project right now, and whether any are blocked on you.", tone: waiting ? "warn" : "neutral", confidence: "verified", tab: "sessions" });
    const ctx = active.map((s) => live[s.id]?.contextPct).filter((v): v is number => typeof v === "number");
    const maxCtx = ctx.length ? Math.max(...ctx) : null;
    m.push({ key: "context", label: "Context", value: maxCtx == null ? "—" : `${Math.round(maxCtx)}%`, detail: maxCtx == null ? "turn on in Connect" : ctx.length > 1 ? "fullest session" : "active session", why: "When a session's memory fills up, Claude summarizes and forgets details. Above 80%, start a fresh session with a handoff.", tone: maxCtx == null ? "neutral" : maxCtx >= 80 ? "bad" : maxCtx >= 60 ? "warn" : "good", confidence: maxCtx == null ? "unknown" : "verified", tab: "sessions" });
    const all = Object.values(live).filter((l): l is LiveStatus => !!l && now - l.updatedAt < 6 * 3600_000);
    const statusDir = path.join(this.home, "status");
    let fiveH: number | null = all.length ? Math.max(...all.map((l) => l.fiveHourPct ?? -1)) : null;
    if (fiveH == null || fiveH < 0) {
      // Limits are account-wide: any recent session's report is valid here.
      try {
        const recent = fs.readdirSync(statusDir).filter((f) => f.endsWith(".json")).map((f) => ({ f, t: fs.statSync(path.join(statusDir, f)).mtimeMs })).filter((x) => now - x.t < 3600_000).sort((a, b) => b.t - a.t);
        for (const r of recent.slice(0, 5)) {
          const l = readLiveStatus(r.f.replace(/\.json$/, ""), this.home);
          if (l?.fiveHourPct != null) {
            fiveH = l.fiveHourPct;
            break;
          }
        }
      } catch {
        /* no status dir */
      }
    }
    m.push({ key: "limit", label: "5h limit", value: fiveH == null || fiveH < 0 ? "—" : `${Math.round(fiveH)}%`, detail: fiveH == null || fiveH < 0 ? "turn on in Connect" : "of plan usage", why: "Your Claude plan's rolling usage limit. Near 100%, sessions pause until it resets, so save it for the important work.", tone: fiveH == null || fiveH < 0 ? "neutral" : fiveH >= 85 ? "bad" : fiveH >= 65 ? "warn" : "good", confidence: fiveH == null || fiveH < 0 ? "unknown" : "verified", tab: "connect" });
    const test = runs.find((t) => /\b(test|vitest|jest|pytest|playwright)\b/.test(t.command));
    const ago = (ts: number) => { const mn = Math.round((now - ts) / 60000); return mn < 1 ? "just now" : mn < 60 ? `${mn} min ago` : mn < 2880 ? `${Math.round(mn / 60)} h ago` : `${Math.round(mn / 1440)} d ago`; };
    m.push({ key: "tests", label: "Tests", value: test ? (test.passed ? "Passing" : "Failing") : "—", detail: test ? ago(test.startedAt) : "not run yet", why: "The only real proof the app still works after AI changes. Run them after every meaningful change.", tone: test ? (test.passed ? "good" : "bad") : "neutral", confidence: test ? "verified" : "unknown", tab: "supervisor" });
    const ch = this.changes;
    const dirty = ch ? ch.unstaged.length + ch.untracked.length + ch.staged.length : null;
    m.push({ key: "unsaved", label: "Unsaved", value: dirty == null ? "—" : String(dirty), detail: dirty == null ? (this.facts?.isGit === false ? "no Git: can't undo" : "…") : dirty ? "uncommitted files" : "all committed", why: "Changes not saved in Git can't be rolled back if the next AI edit goes wrong. Commit or save a checkpoint.", tone: dirty == null ? (this.facts?.isGit === false ? "bad" : "neutral") : dirty >= 15 ? "warn" : "good", confidence: dirty == null ? "unknown" : "verified", tab: "supervisor" });
    let errs = 0;
    let acts = 0;
    for (const s of active) {
      const r = this.store.get<{ a: number; e: number }>("SELECT COUNT(*) AS a, SUM(is_error) AS e FROM events WHERE session_id = ? AND ts > ?", [s.id, now - 3600_000]);
      acts += Number(r?.a ?? 0);
      errs += Number(r?.e ?? 0);
    }
    m.push({ key: "errors", label: "Errors 1h", value: active.length ? String(errs) : "—", detail: active.length ? `${acts} agent actions` : "no activity", why: "Failed commands and tool errors from your agents in the last hour. A rising number usually means an agent is stuck.", tone: !active.length ? "neutral" : errs >= 5 ? "bad" : errs >= 2 ? "warn" : "good", confidence: active.length ? "verified" : "unknown", tab: "sessions" });
    void projectId;
    return m;
  }

  /**
   * Verification loop: a recommendation that was showing and is no longer produced by the rules means the
   * condition behind it is no longer observed. That is recorded as resolved (with the time), never assumed.
   */
  private trackRecommendations(out: SupervisorOutput, now: number): { key: string; title: string; resolvedAt: number }[] {
    const p = this.project;
    if (!p || !this.facts) return [];
    const current = new Set(out.recommendations.map((r) => r.key));
    for (const r of out.recommendations) {
      this.recTitles.set(r.key, r.title);
      this.store.run(
        `INSERT INTO rec_history (project_id, key, first_seen, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET last_seen = excluded.last_seen, resolved_at = NULL`,
        [p.id, r.key, now, now],
      );
    }
    const open = this.store.all<{ key: string }>("SELECT key FROM rec_history WHERE project_id = ? AND resolved_at IS NULL AND (dismissed_until IS NULL OR dismissed_until < ?)", [p.id, now]);
    for (const o of open) if (!current.has(o.key) && !o.key.startsWith("approve:") && !o.key.startsWith("blocked:")) {
      this.store.run("UPDATE rec_history SET resolved_at = ? WHERE project_id = ? AND key = ?", [now, p.id, o.key]);
    }
    return this.store
      .all<{ key: string; resolved_at: number }>("SELECT key, resolved_at FROM rec_history WHERE project_id = ? AND resolved_at > ? ORDER BY resolved_at DESC LIMIT 5", [p.id, now - 7 * 86400_000])
      .map((r) => ({ key: r.key, title: this.recTitles.get(r.key) ?? r.key, resolvedAt: Number(r.resolved_at) }));
  }

  // ---------- demo ----------

  /** Demo sessions are clearly labelled (ids start with "demo-") and can be removed in one step. */
  loadDemo(): void {
    const p = this.project;
    if (!p) throw new Error("Open a project first");
    const now = Date.now();
    const cwd = p.root;
    const f = (n: string) => `${cwd}/src/${n}`;
    const evs: Array<[number, Record<string, unknown>]> = [
      [-50, { session_id: "demo-a1b2c3", hook_event_name: "SessionStart", source: "startup" }],
      [-49, { session_id: "demo-a1b2c3", hook_event_name: "UserPromptSubmit", prompt: "Make the Gmail integration send invoices reliably" }],
      [-48, { session_id: "demo-a1b2c3", hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "d1", tool_input: { file_path: f("gmail.ts") } }],
      [-40, { session_id: "demo-a1b2c3", hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "d2", tool_input: { command: "npm test" }, error: "Exit code 1\nError: invalid_grant: Token has been expired or revoked" }],
      [-30, { session_id: "demo-a1b2c3", hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "d3", tool_input: { command: "npm test" }, error: "Exit code 1\nError: invalid_grant: Token has been expired or revoked" }],
      [-20, { session_id: "demo-a1b2c3", hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "d4", tool_input: { command: "npm test" }, error: "Exit code 1\nError: invalid_grant: Token has been expired or revoked" }],
      [-2, { session_id: "demo-a1b2c3", hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "d5", tool_input: { file_path: f("invoice.ts") } }],
      [-6, { session_id: "demo-d4e5f6", hook_event_name: "UserPromptSubmit", prompt: "Redesign the invoice PDF layout" }],
      [-5, { session_id: "demo-d4e5f6", hook_event_name: "PostToolUse", tool_name: "Write", tool_use_id: "d6", tool_input: { file_path: f("invoice.ts") } }],
      [-1, { session_id: "demo-d4e5f6", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm install pdfkit" } }],
    ];
    for (const [min, e] of evs) this.ingestor.ingestRaw(JSON.stringify({ cwd, ...e }), now + min * 60_000);
    this.demo = true;
    this.emit("changed");
  }

  clearDemo(): void {
    this.store.run("DELETE FROM events WHERE session_id LIKE 'demo-%'");
    this.store.run("DELETE FROM sessions WHERE id LIKE 'demo-%'");
    this.demo = false;
    this.emit("changed");
  }

  hasDemoData(): boolean {
    return Number(this.store.scalar("SELECT COUNT(*) FROM sessions WHERE id LIKE 'demo-%'") ?? 0) > 0;
  }

  private checkAlerts(): void {
    const st = this.snapshot();
    const alerts: Alert[] = [];
    for (const s of st.out.sessions) {
      if (s.id.startsWith("demo-") || s.endedAt || st.generatedAt - s.lastEventAt > 15 * 60_000) continue; // never alert on demo data
      if (s.displayStatus === "awaiting_approval") alerts.push({ key: `approve:${s.id}:${s.lastEventAt}`, level: "warning", title: "Claude needs your approval", message: s.displayReason, sessionId: s.id });
      if (s.displayStatus === "failed") alerts.push({ key: `failed:${s.id}:${s.lastEventAt}`, level: "error", title: "A Claude session failed", message: s.displayReason, sessionId: s.id });
    }
    for (const s of st.elsewhere) {
      if (st.generatedAt - s.lastEventAt > 15 * 60_000) continue;
      if (s.status === "awaiting_approval") alerts.push({ key: `approve:${s.id}:${s.lastEventAt}`, level: "warning", title: `Claude in ${s.folder} needs your approval`, message: s.reason, sessionId: s.id });
    }
    for (const i of st.out.issues) {
      if (i.key.includes("demo-") || (i.sessionId ?? "").startsWith("demo-")) continue;
      if (i.key.startsWith("loop:") || i.key.startsWith("conflict:")) alerts.push({ key: i.key, level: "warning", title: i.title, message: i.plain });
    }
    const now = Date.now();
    for (const a of alerts) {
      const last = this.lastAlertKeys.get(a.key);
      if (last && now - last < 30 * 60_000) continue;
      this.lastAlertKeys.set(a.key, now);
      this.emit("alert", a);
    }
  }
}
