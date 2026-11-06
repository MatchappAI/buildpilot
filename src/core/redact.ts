/**
 * Secret redaction. Applied to every string that is stored, displayed, or placed into a prompt.
 * Conservative: false positives (over-redaction) are acceptable, leaks are not.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]"],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, "[REDACTED ANTHROPIC KEY]"],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{20,}/g, "[REDACTED API KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED GITHUB TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED GITHUB TOKEN]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED SLACK TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED AWS KEY]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED GOOGLE KEY]"],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/g, "[REDACTED STRIPE KEY]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED JWT]"],
  [/(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s]+@/gi, "$1://[REDACTED CREDENTIALS]@"],
  [/(Authorization:\s*(Bearer|Basic)\s+)[^\s"']+/gi, "$1[REDACTED]"],
  // KEY=value style assignments where the key name looks secret
  [
    /\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)[A-Z0-9_]*)\s*[=:]\s*["']?[^\s"'`,;]{4,}["']?/gi,
    "$1=[REDACTED]",
  ],
];

export function redact(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function containsSecret(input: string): boolean {
  return redact(input) !== input;
}

/** Redact and clip. Untrusted text never gets longer than `max` characters. */
export function clip(input: string | null | undefined, max = 400): string {
  if (!input) return "";
  const r = redact(String(input)).replace(/\u0000/g, "");
  return r.length > max ? r.slice(0, max - 1) + "…" : r;
}
