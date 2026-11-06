import { createHash, randomUUID } from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { analyzeRepo, listFiles, RepoFacts, scanSecrets, SecretFinding } from "./analyzer";
import { Store } from "./db";
import { DoctorCheck, runDoctor } from "./doctor";
import { changeSet, Checkpoint, createCheckpoint, gitAvailable, isRepo, listCheckpoints, recentCommits, Commit, run } from "./git";
import { buildpilotHome, claudeSettingsPath, ensureHome, hookStatus, HookStatus } from "./hooks";
import { Ingestor, rowToEvent, rowToSession, SpoolReader } from "./ingest";
import { buildClaudeMd, buildHandoff } from "./memory";
import { buildPrompt, BuiltPrompt, PromptOptions, relevantFiles } from "./prompts";
import { clip } from "./redact";
import { lastTestRun, normalizeError, supervise, SupervisorOutput } from "./supervisor";
import { readUsage } from "./transcript";
import { ChangeSet, Decision, HookEvent, Project, Requirement, Session, TestRun, UsageSnapshot } from "./types";

export interface EngineOptions {
  home?: string;
  inMemory?: boolean;
  claudeSettingsFile?: string;
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
  requirements: Requirement[];
  decisions: Decision[];
  testRuns: TestRun[];
  usage: Record<string, UsageSnapshot>;
  hooks: HookStatus;
  integration: { claudeInstalled: boolean | null; claudeVersion: string | null; gitAvailable: boolean | null; spool: SpoolReader["stats"]; otherProjectSessions: number };
  notes: { goal: string; preferences: string };
  errors: string[];
  runningScript: string | null;
  demo: boolean;
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
    this.store.prune();
    this.ingestor = new Ingestor(this.store, (cwd) => this.resolveProject(cwd));
    this.spool = new SpoolReader(path.join(this.home, "spool"), this.ingestor, (n) => this.onIngest(n));
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
    const abs = path.resolve(cwd);
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
    const abs = path.resolve(root);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
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

  // ---------- snapshot ----------

  snapshot(now = Date.now()): UiState {
    const p = this.project;
    const sessions = p ? this.sessionsForProject(p.id) : [];
    const eventsBySession = new Map<string, HookEvent[]>();
    for (const s of sessions.slice(0, 12)) eventsBySession.set(s.id, this.eventsFor(s.id));
    const testRuns = this.testRuns();
    const requirements = this.requirements();
    const hooks = hookStatus(this.settingsFile, this.home);
    const lastCp = this.checkpoints[0];
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
    });
    const usage: Record<string, UsageSnapshot> = {};
    for (const s of sessions.slice(0, 12)) usage[s.id] = this.usageFor(s);
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
      requirements,
      decisions: this.decisions(),
      testRuns,
      usage,
      hooks,
      integration: { claudeInstalled: this.claude.installed, claudeVersion: this.claude.version, gitAvailable: this.gitOk, spool: this.spool?.stats ?? { accepted: 0, duplicates: 0, rejected: 0, lastEventAt: 0 }, otherProjectSessions },
      notes: { goal: this.note("goal"), preferences: this.note("preferences") },
      errors: this.errors,
      runningScript: this.runningScript,
      demo: this.demo,
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
    if (state.out.next) parts.push(`Next: ${state.out.next.title}.`);
    return parts.join(" ");
  }

  private checkAlerts(): void {
    const st = this.snapshot();
    const alerts: Alert[] = [];
    for (const s of st.out.sessions) {
      if (s.endedAt || st.generatedAt - s.lastEventAt > 15 * 60_000) continue;
      if (s.displayStatus === "awaiting_approval") alerts.push({ key: `approve:${s.id}:${s.lastEventAt}`, level: "warning", title: "Claude needs your approval", message: s.displayReason, sessionId: s.id });
      if (s.displayStatus === "failed") alerts.push({ key: `failed:${s.id}:${s.lastEventAt}`, level: "error", title: "A Claude session failed", message: s.displayReason, sessionId: s.id });
    }
    for (const i of st.out.issues) {
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
