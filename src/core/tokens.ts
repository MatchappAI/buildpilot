import { shortCommand } from "./activity";
import * as fs from "fs";
import * as path from "path";
import { claudeConfigDir, isSafeTranscriptPath } from "./transcript";

/**
 * "Where the tokens went" for one Claude Code session, from its transcript (read-only, bounded).
 * Everything is measured from the transcript; sizes of tool output are estimated at ~4 characters per token
 * and labelled "≈". Nothing is sent anywhere.
 */
export interface TokenItem { label: string; tokens: number }
export interface TokenReport {
  /** Input tokens on the first turn: system prompt + tool/MCP definitions + CLAUDE.md, before your first message. */
  baseline: number | null;
  /** Current context size (input on the latest turn). */
  context: number | null;
  /** All input tokens sent across turns (incl. cached re-reads): what actually drives limit use. */
  inputTotal: number;
  output: number;
  thinking: number;
  turns: number;
  /** Models used, most turns first, e.g. [["claude-opus-5-5", 40], ["claude-sonnet-5-5", 3]]. */
  models: [string, number][];
  subagents: number;
  /** Biggest tool outputs pulled into the chat (≈ tokens), largest first. */
  top: TokenItem[];
  /** Tool output by tool name (≈ tokens). */
  byTool: TokenItem[];
  compactions: number;
}

const HEAD = 512 * 1024;
const TAIL = 4 * 1024 * 1024;
const cache = new Map<string, { mtime: number; size: number; report: TokenReport }>();
const est = (chars: number) => Math.round(chars / 4);

function readBounded(file: string): { head: string; body: string } {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  try {
    if (st.size <= TAIL) {
      const b = Buffer.alloc(st.size);
      fs.readSync(fd, b, 0, st.size, 0);
      const t = b.toString("utf8");
      return { head: t, body: t };
    }
    const h = Buffer.alloc(HEAD);
    fs.readSync(fd, h, 0, HEAD, 0);
    const t = Buffer.alloc(TAIL);
    fs.readSync(fd, t, 0, TAIL, st.size - TAIL);
    return { head: h.toString("utf8"), body: t.toString("utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

function target(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const fp = s(input.file_path) || s(input.path) || s(input.notebook_path);
  if (fp) return `${name === "Read" ? "File" : name === "Edit" || name === "Write" || name === "MultiEdit" ? "Edit of" : name} ${path.basename(fp)}`;
  if (name === "Bash") return `Output of ${shortCommand(s(input.command).replace(/\s+/g, " "))}`;
  if (name === "Grep" || name === "Glob") return `Search for ${s(input.pattern).slice(0, 40)}`;
  if (name === "WebFetch") return `Web page ${s(input.url).replace(/^https?:\/\//, "").slice(0, 50)}`;
  if (name === "Task" || name === "Agent") return `Subagent ${s(input.description).slice(0, 50)}`;
  return name;
}

export function parseTokens(head: string, body: string): TokenReport {
  const lines = (txt: string) => txt.split("\n").filter((l) => l.startsWith("{"));
  const usageIn = (u: Record<string, unknown>) => ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].reduce((a, k) => a + (typeof u[k] === "number" ? (u[k] as number) : 0), 0);
  let baseline: number | null = null;
  for (const l of lines(head)) {
    if (!l.includes('"usage"')) continue;
    try {
      const o = JSON.parse(l);
      if (o.type === "assistant" && o.message?.usage) { const b = usageIn(o.message.usage); baseline = b > 0 ? b : null; break; }
    } catch { /* partial line */ }
  }
  const tools = new Map<string, { name: string; label: string }>();
  const seen = new Set<string>();
  const models = new Map<string, number>();
  const sizes: TokenItem[] = [];
  const byTool = new Map<string, number>();
  let context: number | null = null;
  let output = 0;
  let inputTotal = 0;
  let thinking = 0;
  let turns = 0;
  let subagents = 0;
  let compactions = 0;
  for (const l of lines(body)) {
    let o: Record<string, unknown>;
    try { o = JSON.parse(l); } catch { continue; }
    if ((o.type === "system" && o.subtype === "compact_boundary") || o.isCompactSummary === true) { compactions++; continue; }
    const msg = o.message as Record<string, unknown> | undefined;
    if (!msg || !Array.isArray(msg.content)) {
      if (o.type === "assistant" && msg?.usage) { /* usage-only line */ } else continue;
    }
    if (o.type === "assistant") {
      for (const c of (msg!.content as Record<string, unknown>[]) ?? []) {
        if (c.type === "tool_use" && typeof c.id === "string") {
          const name = String(c.name ?? "tool");
          tools.set(c.id, { name, label: target(name, (c.input as Record<string, unknown>) ?? {}) });
          if (name === "Task" || name === "Agent") subagents++;
        }
      }
      const id = typeof msg!.id === "string" ? msg!.id : null;
      const u = msg!.usage as Record<string, unknown> | undefined;
      if (u && !(id && seen.has(id))) {
        if (id) seen.add(id);
        turns++;
        context = usageIn(u);
        inputTotal += context;
        output += typeof u.output_tokens === "number" ? u.output_tokens : 0;
        const det = u.output_tokens_details as Record<string, unknown> | undefined;
        thinking += typeof det?.thinking_tokens === "number" ? (det.thinking_tokens as number) : 0;
        const m = typeof msg!.model === "string" && msg!.model !== "<synthetic>" ? msg!.model : null;
        if (m) models.set(m, (models.get(m) ?? 0) + 1);
      }
    } else if (o.type === "user") {
      for (const c of (msg!.content as Record<string, unknown>[]) ?? []) {
        if (c.type !== "tool_result") continue;
        const t = tools.get(String(c.tool_use_id ?? ""));
        const content = c.content;
        const chars = typeof content === "string" ? content.length : Array.isArray(content) ? content.reduce((a: number, x: Record<string, unknown>) => a + (typeof x.text === "string" ? x.text.length : x.type === "image" ? 6000 : 0), 0) : 0;
        if (!chars) continue;
        const tokens = est(chars);
        sizes.push({ label: t?.label ?? "Tool output", tokens });
        const k = t?.name ?? "Other";
        byTool.set(k, (byTool.get(k) ?? 0) + tokens);
      }
    }
  }
  // Merge repeated reads of the same thing ("Read package-lock.json" twice = one line, summed).
  const merged = new Map<string, number>();
  for (const s of sizes) merged.set(s.label, (merged.get(s.label) ?? 0) + s.tokens);
  return {
    baseline,
    context,
    inputTotal,
    output,
    thinking,
    turns,
    models: [...models.entries()].sort((a, b) => b[1] - a[1]),
    subagents,
    top: [...merged.entries()].map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    byTool: [...byTool.entries()].map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens),
    compactions,
  };
}

/** Report for a transcript path recorded by the hooks; null when unknown or outside ~/.claude. Cached by mtime. */
export function tokenReport(transcriptPath: string | null, base = claudeConfigDir()): TokenReport | null {
  if (!transcriptPath || !isSafeTranscriptPath(transcriptPath, base)) return null;
  try {
    const st = fs.statSync(transcriptPath);
    const c = cache.get(transcriptPath);
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.report;
    const { head, body } = readBounded(transcriptPath);
    const report = parseTokens(head, body);
    cache.set(transcriptPath, { mtime: st.mtimeMs, size: st.size, report });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    return report;
  } catch {
    return null;
  }
}

/** "38k" style. */
export const kTokens = (n: number) => (n >= 1000 ? `${n >= 10000 ? Math.round(n / 1000) : (n / 1000).toFixed(1)}k` : String(n));
