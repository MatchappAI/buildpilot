import { shellQuote } from "../core/prompts";

/**
 * How to start `claude` with a prompt stored in a file, per shell. Pure (no vscode import) so it is unit-tested.
 * - POSIX shells: claude "$(cat '<file>')"  (prompt passed as one argument, never evaluated)
 * - PowerShell:   claude (Get-Content -Raw '<file>')
 * - cmd.exe:      can't pass multi-line args safely, so start claude and paste from the clipboard
 */
export type LaunchPlan = { kind: "command"; text: string } | { kind: "paste"; text: string };

export function launchPlan(file: string, platform: NodeJS.Platform, shell: string): LaunchPlan {
  const sh = shell.toLowerCase();
  if (platform === "win32" && (sh.includes("powershell") || sh.includes("pwsh"))) return { kind: "command", text: `claude (Get-Content -Raw '${file.replace(/'/g, "''")}')` };
  if (platform === "win32" && !sh.includes("bash")) return { kind: "paste", text: "claude" };
  return { kind: "command", text: `claude "$(cat ${shellQuote(file)})"` };
}
