import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

export function tmpDir(prefix = "bp-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeRepo(files: Record<string, string>, commit = true): string {
  const d = tmpDir("bp-repo-");
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  execFileSync("git", ["init", "-q"], { cwd: d });
  if (commit) {
    execFileSync("git", ["add", "-A"], { cwd: d });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: d });
  }
  return d;
}

export function payload(o: Record<string, unknown>): string {
  return JSON.stringify({ session_id: "s1", cwd: "/tmp/proj", transcript_path: "/x.jsonl", ...o });
}
