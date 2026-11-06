/** Pick the Prompt Studio goal from plain words, so users never have to choose one. Pure; shared by page + CLI. */
export function guessGoal(text: string): string {
  const t = text.toLowerCase();
  if (/\b(bug|broken|fix|error|crash|doesn'?t work|not working|fails?)\b/.test(t)) return "bugfix";
  if (/\b(deploy|launch|ship|host|publish|go live)\b/.test(t)) return "deploy";
  if (/\b(test|tests|testing)\b/.test(t)) return "tests";
  if (/\b(slow|speed|faster|performance)\b/.test(t)) return "performance";
  if (/\b(secure|security|password|leak|secret)\b/.test(t)) return "security";
  if (/\b(design|layout|look|style|css|ui|button|page|screen)\b/.test(t)) return "ui";
  if (/\b(connect|integrat|api|stripe|gmail|google|webhook)\w*/.test(t)) return "integration";
  if (/\b(explain|understand|what does|how does)\b/.test(t)) return "explain";
  if (/\b(clean ?up|refactor|reorganize|simplify)\b/.test(t)) return "refactor";
  return "feature";
}
