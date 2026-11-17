import * as fs from "fs";

/**
 * Test seam: with BUILDPILOT_OS_LOG set, OS side effects (Terminal, clipboard, notifications, opening links, bringing a
 * terminal tab forward) are written to that file as JSON lines instead of happening, so end-to-end and model-based runs
 * never touch the user's screen or clipboard. Returns true when the effect was logged (and must not happen).
 */
export function osLog(kind: string, data: Record<string, unknown>): boolean {
  const f = process.env.BUILDPILOT_OS_LOG;
  if (!f) return false;
  try { fs.appendFileSync(f, JSON.stringify({ kind, ...data, at: Date.now() }) + "\n"); } catch { /* best effort */ }
  return true;
}
