import * as fs from "fs";
import * as path from "path";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";

/**
 * SQLite persistence.
 * Primary backend: Node's built-in `node:sqlite` (VS Code ships Node 24; system Node >= 22.5) in WAL mode with a
 * busy timeout, so several processes (multiple VS Code windows, the terminal CLI) can read and write the same
 * database safely, statement by statement (docs/DECISIONS.md, D-011).
 * Fallback: sql.js (WASM) for runtimes without node:sqlite: single-writer, whole-file atomic flushes (D-003).
 */

export type SqlValue = string | number | null | Uint8Array;
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
  // 4: Claude's own checklist per session (JSON, see types.ts Checklist)
  `ALTER TABLE sessions ADD COLUMN checklist TEXT;`,
];

let sqlPromise: Promise<SqlJsStatic> | null = null;

function locateWasm(): string {
  const candidates = [
    path.join(__dirname, "sql-wasm.wasm"), // bundled next to dist/extension.js
    path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"), // src/core during tests
    path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("BuildPilot is missing a file (sql-wasm.wasm). Reinstall BuildPilot, or update Node.js to version 22.5 or newer.");
}

interface Backend {
  readonly kind: "node:sqlite" | "sql.js";
  exec(sql: string): void;
  run(sql: string, params: SqlValue[]): number; // returns changed rows
  all(sql: string, params: SqlValue[]): Record<string, SqlValue>[];
  flush(): void;
  close(): void;
}

type NodeSqlite = { DatabaseSync: new (file: string, opts?: Record<string, unknown>) => NodeDb };
interface NodeDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...p: SqlValue[]): { changes: number | bigint }; all(...p: SqlValue[]): Record<string, SqlValue>[] };
  close(): void;
}

function loadNodeSqlite(): NodeSqlite | null {
  if (process.env.BUILDPILOT_FORCE_SQLJS === "1") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:sqlite") as NodeSqlite;
  } catch {
    return null;
  }
}

class NodeBackend implements Backend {
  readonly kind = "node:sqlite" as const;
  private cache = new Map<string, ReturnType<NodeDb["prepare"]>>();
  constructor(private readonly db: NodeDb) {}
  static open(mod: NodeSqlite, file: string | null): NodeBackend {
    const db = new mod.DatabaseSync(file ?? ":memory:");
    if (file) {
      // busy_timeout first: switching to WAL needs a lock another process may briefly hold.
      db.exec("PRAGMA busy_timeout = 4000");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
    }
    db.exec("SELECT count(*) FROM sqlite_master"); // validates the file header
    return new NodeBackend(db);
  }
  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(sql, s);
    }
    return s;
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  run(sql: string, params: SqlValue[]): number {
    return Number(this.stmt(sql).run(...params).changes);
  }
  all(sql: string, params: SqlValue[]): Record<string, SqlValue>[] {
    return this.stmt(sql).all(...params).map((r) => ({ ...r }));
  }
  flush(): void {
    /* every statement is already durable */
  }
  close(): void {
    this.cache.clear();
    this.db.close();
  }
}

class SqlJsBackend implements Backend {
  readonly kind = "sql.js" as const;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  /**
   * readOnly: the file is (or was) used by node:sqlite in WAL mode. sql.js can't see WAL pages and would replace the
   * file under the other processes, losing their writes, so this process keeps its changes in memory only.
   */
  constructor(private readonly db: Database, private readonly file: string | null, readonly readOnly = false) {}
  exec(sql: string): void {
    this.db.exec(sql);
    this.markDirty();
  }
  run(sql: string, params: SqlValue[]): number {
    this.db.run(sql, params);
    this.markDirty();
    return this.db.getRowsModified();
  }
  all(sql: string, params: SqlValue[]): Record<string, SqlValue>[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Record<string, SqlValue>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, SqlValue>);
      return rows;
    } finally {
      stmt.free();
    }
  }
  private markDirty(): void {
    this.dirty = true;
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 750);
  }
  flush(): void {
    if (!this.file || !this.dirty || this.readOnly) return;
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
}

/** True only for errors that mean the file itself is damaged (not busy, locked or unreadable for another reason). */
export function isCorruption(e: unknown): boolean {
  const m = `${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? e}`;
  return /SQLITE_CORRUPT|SQLITE_NOTADB|malformed|not a database|file is encrypted/i.test(m);
}

/** True when another runtime uses this file in WAL mode (header bytes 18/19 = 2, or a -wal file exists). */
export function usesWal(file: string): boolean {
  if (fs.existsSync(`${file}-wal`)) return true;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const b = Buffer.alloc(2);
      fs.readSync(fd, b, 0, 2, 18);
      return b[0] === 2 || b[1] === 2;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function quarantine(file: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, `${file}${suffix}.corrupt-${Date.now()}`);
  }
}

export class Store {
  private lastChanges = 0;
  private constructor(private readonly b: Backend, readonly file: string | null) {}

  get backend(): Backend["kind"] {
    return this.b.kind;
  }

  /** file = null -> in-memory (tests). Corrupt files are kept aside (never deleted) and a fresh DB is created. */
  static async open(file: string | null): Promise<Store> {
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const mod = loadNodeSqlite();
    let backend: Backend;
    if (mod) {
      try {
        backend = NodeBackend.open(mod, file);
      } catch (e) {
        if (!file) throw new Error("Could not open in-memory database");
        if (isCorruption(e)) {
          quarantine(file); // kept aside, never deleted
          backend = NodeBackend.open(mod, file);
        } else {
          // Busy, locked, permissions, too many files: never treat as damage. Wait once, then report.
          sleep(1500);
          backend = NodeBackend.open(mod, file);
        }
      }
      if (file) {
        try {
          fs.chmodSync(file, 0o600);
        } catch {
          /* best effort */
        }
      }
    } else {
      sqlPromise ??= initSqlJs({ locateFile: () => locateWasm() });
      const SQL = await sqlPromise;
      let db: Database;
      const shared = !!file && fs.existsSync(file) && usesWal(file);
      if (file && fs.existsSync(file)) {
        try {
          db = new SQL.Database(fs.readFileSync(file));
          db.exec("SELECT count(*) FROM sqlite_master");
        } catch (e) {
          if (shared || !isCorruption(e)) throw new Error("BuildPilot can't read its data with this Node.js version. Update Node.js to 22.13 or newer.");
          quarantine(file);
          db = new SQL.Database();
        }
      } else db = new SQL.Database();
      backend = new SqlJsBackend(db, file, shared);
    }
    const store = new Store(backend, file);
    store.migrate();
    return store;
  }

  get schemaVersion(): number {
    return Number(this.scalar("PRAGMA user_version") ?? 0);
  }

  private migrate(): void {
    if (this.schemaVersion >= MIGRATIONS.length) return;
    // IMMEDIATE takes the write lock up front, so two processes can't migrate at the same time.
    this.b.exec("BEGIN IMMEDIATE");
    try {
      const v = this.schemaVersion; // re-read inside the lock
      for (let i = v; i < MIGRATIONS.length; i++) {
        this.b.exec(MIGRATIONS[i]!);
        this.b.exec(`PRAGMA user_version = ${i + 1}`);
      }
      this.b.exec("COMMIT");
    } catch (e) {
      this.b.exec("ROLLBACK");
      throw e;
    }
  }

  run(sql: string, params: SqlValue[] = []): void {
    this.lastChanges = this.b.run(sql, params);
  }

  all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
    return this.b.all(sql, params) as T[];
  }

  get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar(sql: string, params: SqlValue[] = []): SqlValue | undefined {
    const row = this.get(sql, params);
    return row ? Object.values(row)[0] : undefined;
  }

  /** Rows changed by the last run(). */
  changes(): number {
    return this.lastChanges;
  }

  flush(): void {
    this.b.flush();
  }

  close(): void {
    this.b.close();
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
    // Sessions with nothing left and no activity for the same period (demo rows and hidden history included).
    this.run("DELETE FROM sessions WHERE last_event_at < ? AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = sessions.id)", [cutoff]);
  }
}
