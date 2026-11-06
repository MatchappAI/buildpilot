import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ChangeSet } from "./types";

/**
 * Git access. Always execFile with an argument array (never a shell string), always with a timeout.
 * Nothing here discards, resets, or rewrites user work. Checkpoints are stored as private refs
 * (refs/buildpilot/checkpoints/*) built from a temporary index, so the user's index, branch and
 * working tree are untouched.
 */

export function run(cmd: string, args: string[], cwd: string, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: opts.timeoutMs ?? 15000, maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024, env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? Number((err as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && !stdout ? String(err.message) : "") });
      },
    );
  });
}

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => run("git", args, cwd, { env });

export async function isRepo(root: string): Promise<boolean> {
  const r = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function gitAvailable(): Promise<boolean> {
  return (await run("git", ["--version"], os.homedir())).code === 0;
}

export async function changeSet(root: string): Promise<ChangeSet | null> {
  const r = await git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"]);
  if (r.code !== 0) return null;
  return parseStatus(r.stdout);
}

export function parseStatus(out: string): ChangeSet {
  const cs: ChangeSet = { branch: null, head: null, staged: [], unstaged: [], untracked: [], ahead: null, behind: null };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!;
    if (line.startsWith("# branch.head ")) cs.branch = line.slice(14) === "(detached)" ? null : line.slice(14);
    else if (line.startsWith("# branch.oid ")) cs.head = line.slice(13) === "(initial)" ? null : line.slice(13);
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        cs.ahead = Number(m[1]);
        cs.behind = Number(m[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const fields = line.split(" ");
      const xy = fields[1] ?? "..";
      const file = line.startsWith("1 ") ? fields.slice(8).join(" ") : fields.slice(9).join(" ");
      if (line.startsWith("2 ")) i++; // rename: original path follows as next NUL field
      if (xy[0] !== ".") cs.staged.push(file);
      if (xy[1] !== ".") cs.unstaged.push(file);
    } else if (line.startsWith("u ")) {
      const fields = line.split(" ");
      cs.unstaged.push(fields.slice(10).join(" "));
    } else if (line.startsWith("? ")) cs.untracked.push(line.slice(2));
  }
  return cs;
}

export interface Commit {
  sha: string;
  ts: number;
  subject: string;
}

export async function recentCommits(root: string, n = 15): Promise<Commit[]> {
  const r = await git(root, ["log", `-n${n}`, "--pretty=format:%H%x1f%ct%x1f%s"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ct, subject] = l.split("\x1f");
      return { sha: sha ?? "", ts: Number(ct) * 1000, subject: subject ?? "" };
    });
}

export async function trackedFiles(root: string): Promise<string[] | null> {
  const r = await git(root, ["ls-files", "-z"]);
  if (r.code !== 0) return null;
  return r.stdout.split("\0").filter(Boolean);
}

/** Tracked + untracked-but-not-ignored files. */
export async function projectFiles(root: string): Promise<string[] | null> {
  const r = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (r.code !== 0) return null;
  return [...new Set(r.stdout.split("\0").filter(Boolean))];
}

export async function worktrees(root: string): Promise<string[]> {
  const r = await git(root, ["worktree", "list", "--porcelain"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9));
}

export interface Checkpoint {
  ref: string;
  sha: string;
  ts: number;
  label: string;
}

/** Snapshot the whole working tree (tracked + untracked, respecting .gitignore) without touching the user's index or branch. */
export async function createCheckpoint(root: string, label: string): Promise<Checkpoint> {
  const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "buildpilot-idx-")), "index");
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
    if (head.code === 0) {
      const rt = await git(root, ["read-tree", "HEAD"], env);
      if (rt.code !== 0) throw new Error(rt.stderr);
    }
    const add = await git(root, ["add", "-A", "--", "."], env);
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.trim()}`);
    const tree = await git(root, ["write-tree"], env);
    if (tree.code !== 0) throw new Error(tree.stderr);
    const ts = Date.now();
    const msg = `BuildPilot checkpoint: ${label}`.slice(0, 200);
    const args = ["-c", "user.name=BuildPilot", "-c", "user.email=buildpilot@localhost", "commit-tree", tree.stdout.trim(), "-m", msg];
    if (head.code === 0) args.push("-p", head.stdout.trim());
    const ct = await git(root, args);
    if (ct.code !== 0) throw new Error(ct.stderr);
    const sha = ct.stdout.trim();
    const ref = `refs/buildpilot/checkpoints/${ts}`;
    const ur = await git(root, ["update-ref", ref, sha]);
    if (ur.code !== 0) throw new Error(ur.stderr);
    return { ref, sha, ts, label };
  } finally {
    fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true });
  }
}

export async function listCheckpoints(root: string): Promise<Checkpoint[]> {
  const r = await git(root, ["for-each-ref", "--sort=-refname", "--format=%(refname)%1f%(objectname)%1f%(contents:subject)", "refs/buildpilot/checkpoints/"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [ref, sha, subj] = l.split("\x1f");
      return { ref: ref ?? "", sha: sha ?? "", ts: Number((ref ?? "").split("/").pop()), label: (subj ?? "").replace(/^BuildPilot checkpoint: /, "") };
    });
}

/** Files that differ between a checkpoint and the current working tree. */
export async function diffSinceCheckpoint(root: string, sha: string): Promise<string[]> {
  const r = await git(root, ["diff", "--name-only", sha, "--"]);
  if (r.code !== 0) return [];
  const untracked = (await changeSet(root))?.untracked ?? [];
  return [...new Set([...r.stdout.split("\n").filter(Boolean), ...untracked])];
}

/**
 * Scoped rollback of specific files to a checkpoint. Takes a fresh checkpoint first so the rollback itself
 * can be undone. Caller must have explicit user approval. Never touches files not listed.
 */
export async function restoreFiles(root: string, sha: string, files: string[]): Promise<{ safety: Checkpoint; restored: string[] }> {
  if (files.length === 0) throw new Error("No files selected");
  for (const f of files) {
    if (path.isAbsolute(f) || f.split(/[\\/]/).includes("..")) throw new Error(`Refusing unsafe path: ${f}`);
  }
  const safety = await createCheckpoint(root, "before rollback");
  const r = await git(root, ["restore", `--source=${sha}`, "--worktree", "--", ...files]);
  if (r.code !== 0) throw new Error(r.stderr.trim());
  return { safety, restored: files };
}
