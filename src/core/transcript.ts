import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UsageSnapshot } from "./types";

/**
 * Reads token usage from Claude Code's LOCAL transcript files (JSONL under ~/.claude/projects).
 * Only paths inside the Claude config directory are read, so a forged hook payload cannot point us at other files.
 * Values are what the transcript records; context-window % is NOT computed because the window size is not
 * reliably exposed (it differs by model and plan). Cost is not computed: subscription usage has no per-token price.
 */

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function isSafeTranscriptPath(p: string, base = claudeConfigDir()): boolean {
  const resolved = path.resolve(p);
  const root = path.resolve(base) + path.sep;
  return resolved.startsWith(root) && resolved.endsWith(".jsonl");
}

export function readUsage(transcriptPath: string | null, base = claudeConfigDir(), maxBytes = 4 * 1024 * 1024): UsageSnapshot {
  const none: UsageSnapshot = { model: null, lastTurnInputTokens: null, totalOutputTokens: null, assistantTurns: 0, contextWindowEstimate: null, source: "none" };
  if (!transcriptPath || !isSafeTranscriptPath(transcriptPath, base)) return none;
  let text: string;
  try {
    const st = fs.statSync(transcriptPath);
    const hit = usageCache.get(transcriptPath);
    if (hit && ((hit.size === st.size && hit.mtime === st.mtimeMs) || Date.now() - hit.at < USAGE_TTL_MS)) return hit.snap;
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return none;
  }
  const snap = parseUsage(text);
  try {
    const st = fs.statSync(transcriptPath);
    usageCache.set(transcriptPath, { size: st.size, mtime: st.mtimeMs, at: Date.now(), snap });
    if (usageCache.size > 60) usageCache.delete(usageCache.keys().next().value as string);
  } catch {
    /* gone */
  }
  return snap;
}

/** Per-transcript cache: unchanged files are never re-read, and a busy one at most every 10 s. */
const usageCache = new Map<string, { size: number; mtime: number; at: number; snap: UsageSnapshot }>();
const USAGE_TTL_MS = 10_000;

export function parseUsage(jsonl: string): UsageSnapshot {
  let model: string | null = null;
  let lastIn: number | null = null;
  let out = 0;
  let turns = 0;
  const seen = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // first line may be partial
    }
    const msg = o.message as Record<string, unknown> | undefined;
    if (!msg || o.type !== "assistant") continue;
    const u = msg.usage as Record<string, unknown> | undefined;
    if (!u) continue;
    // One API response can be split over several transcript lines with the same message id; count once.
    const id = typeof msg.id === "string" ? msg.id : null;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const n = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
    lastIn = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
    out += n("output_tokens");
    turns++;
    if (typeof msg.model === "string" && msg.model !== "<synthetic>") model = msg.model;
  }
  if (turns === 0) return { model, lastTurnInputTokens: null, totalOutputTokens: null, assistantTurns: 0, contextWindowEstimate: null, source: "none" };
  return {
    model,
    lastTurnInputTokens: lastIn,
    totalOutputTokens: out,
    assistantTurns: turns,
    contextWindowEstimate: lastIn != null ? { tokens: lastIn, basis: "tokens sent on the latest turn (≈ current context size)" } : null,
    source: "transcript",
  };
}
