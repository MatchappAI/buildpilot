import * as fs from "fs";
import * as path from "path";
import initSqlJs, { Database, SqlJsStatic, SqlValue } from "sql.js";

/**
 * SQLite persistence via sql.js (WASM). Chosen over native bindings so the extension
 * installs on any OS / VS Code Electron version without a native rebuild (see docs/DECISIONS.md, D-003).
 * Only the BuildPilot process writes this file; hooks write to a spool directory instead.
 */

export const MIGRATIONS: string[] = [
  // 1: core tables
  `CREATE TABLE projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_analyzed_at INTEGER);
   CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT NOT NULL, transcript_path TEXT, status TEXT NOT NULL, status_reason TEXT NOT NULL DEFAULT '',
     current_task TEXT, model TEXT, permission_mode TEXT, started_at INTEGER NOT NULL, last_event_at INTEGER NOT NULL, ended_at INTEGER,
     event_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, hook_event TEXT NOT NULL, ts INTEGER NOT NULL, tool_name TEXT, tool_use_id TEXT,
     summary TEXT NOT NULL, file_path TEXT, is_error INTEGER NOT NULL DEFAULT 0, error_text TEXT, agent_id TEXT, fingerprint TEXT NOT NULL UNIQUE);
   CREATE INDEX idx_events_session ON events(session_id, ts);
   CREATE TABLE requirements (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, acceptance TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
     evidence TEXT NOT NULL DEFAULT 'unknown', evidence_note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE test_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, command TEXT NOT NULL, started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
     exit_code INTEGER, passed INTEGER NOT NULL, output_tail TEXT NOT NULL, source TEXT NOT NULL);
   CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, approved_at INTEGER NOT NULL, outcome TEXT);
   CREATE TABLE notes (project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(project_id, key));`,
  // 2: recommendation history (for verification + "don't nag twice")
  `CREATE TABLE rec_history (project_id TEXT NOT NULL, key TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, dismissed_until INTEGER,
     resolved_at INTEGER, PRIMARY KEY(project_id, key));`,
  // 3: usage per session (from local transcripts only)
  `ALTER TABLE sessions ADD COLUMN last_turn_input_tokens INTEGER;
   ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER;
   ALTER TABLE sessions ADD COLUMN assistant_turns INTEGER NOT NULL DEFAULT 0;`,
];

let sqlPromise: Promise<SqlJsStatic> | null = null;

function locateWasm(): string {
  const candidates = [
    path.join(__dirname, "sql-wasm.wasm"), // bundled next to dist/extension.js
    path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"), // src/core during tests
    path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("BuildPilot could not find sql-wasm.wasm. Reinstall the extension.");
}

export class Store {
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor(
    private readonly db: Database,
    readonly file: string | null,
  ) {}

  /** file = null -> in-memory (tests). */
  static async open(file: string | null): Promise<Store> {
    sqlPromise ??= initSqlJs({ locateFile: () => locateWasm() });
    const SQL = await sqlPromise;
    let db: Database;
    if (file && fs.existsSync(file)) {
      try {
        db = new SQL.Database(fs.readFileSync(file));
        db.exec("SELECT count(*) FROM sqlite_master"); // forces header validation
      } catch {
        // Corrupt file: keep it for inspection, start fresh. Never delete user data silently.
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
    const store = new Store(db, file);
    store.migrate();
    return store;
  }

  get schemaVersion(): number {
    return Number(this.scalar("PRAGMA user_version") ?? 0);
  }

  private migrate(): void {
    const v = this.schemaVersion;
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    if (MIGRATIONS.length > v) this.markDirty();
  }

  run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
    this.markDirty();
  }

  all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar(sql: string, params: SqlValue[] = []): SqlValue | undefined {
    const row = this.get(sql, params);
    return row ? Object.values(row)[0] : undefined;
  }

  changes(): number {
    return this.db.getRowsModified();
  }

  private markDirty(): void {
    this.dirty = true;
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 750);
  }

  /** Atomic write: temp file then rename, owner-only permissions. */
  flush(): void {
    if (!this.file || !this.dirty) return;
    const data = this.db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush();
    this.db.close();
  }

  /** User-facing data deletion. */
  deleteProjectData(projectId: string): void {
    const sessions = this.all<{ id: string }>("SELECT id FROM sessions WHERE project_id = ?", [projectId]);
    for (const s of sessions) this.run("DELETE FROM events WHERE session_id = ?", [s.id]);
    for (const t of ["sessions", "requirements", "test_runs", "decisions", "approvals", "notes", "rec_history"]) {
      this.run(`DELETE FROM ${t} WHERE project_id = ?`, [projectId]);
    }
  }

  deleteAll(): void {
    for (const t of ["events", "sessions", "requirements", "test_runs", "decisions", "approvals", "notes", "rec_history", "projects"]) {
      this.run(`DELETE FROM ${t}`);
    }
  }

  /** Retention: keep event history bounded. */
  prune(maxEventsPerSession = 2000, maxAgeDays = 30): void {
    const cutoff = Date.now() - maxAgeDays * 86400_000;
    this.run("DELETE FROM events WHERE ts < ?", [cutoff]);
    this.run(
      `DELETE FROM events WHERE id IN (
         SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts DESC, id DESC) AS rn FROM events) WHERE rn > ?)`,
      [maxEventsPerSession],
    );
  }
}
