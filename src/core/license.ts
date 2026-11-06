import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Freemium gate for Prompt Studio. Everything else in BuildPilot stays free.
 * - Usage: <home>/usage.json counts successful prompt generations (local, resettable by design).
 * - License: BUILDPILOT_LICENSE_KEY / BUILDPILOT_AUTH_TOKEN env, or <home>/license.json.
 *   Keys are Ed25519-signed ("BP1.<payload>.<sig>"), verified offline; only the issuer's
 *   private key (kept outside this repo) can mint them, so they can't be forged from this code.
 */

export const FREE_PROMPTS = 20;
/** Stripe Payment Link. Replace with the real buy.stripe.com link; BUILDPILOT_CHECKOUT_URL overrides. */
export const CHECKOUT_URL = "https://buy.stripe.com/REPLACE_WITH_PAYMENT_LINK";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7wNACNiV5ED9mb6g4/V+y3lZAcKXKI/1F/FzIjVrLTQ=
-----END PUBLIC KEY-----`;

export interface License { valid: boolean; plan?: string; sub?: string; source?: "env" | "file"; reason?: string }
export interface Usage { installId: string; count: number }
export interface Paywall { message: string; url: string; used: number; limit: number }
export type Gate = { allowed: true; licensed: boolean; remaining: number | null } | { allowed: false; paywall: Paywall };

const usagePath = (home: string) => path.join(home, "usage.json");
const licensePath = (home: string) => path.join(home, "license.json");

function readJson<T>(file: string): Partial<T> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<T>;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readUsage(home: string): Usage {
  const u = readJson<Usage>(usagePath(home));
  const ok = typeof u.installId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(u.installId);
  const usage: Usage = { installId: ok ? u.installId! : crypto.randomUUID(), count: Number.isInteger(u.count) && u.count! >= 0 ? u.count! : 0 };
  if (!ok) writeJson(usagePath(home), usage);
  return usage;
}

export function verifyKey(key: string, publicKey = PUBLIC_KEY): License {
  const m = /^BP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.trim());
  if (!m) return { valid: false, reason: "not a BuildPilot key" };
  const [, body, sig] = m as unknown as [string, string, string];
  try {
    const ok = crypto.verify(null, Buffer.from(`BP1.${body}`), publicKey, Buffer.from(sig, "base64url"));
    if (!ok) return { valid: false, reason: "signature doesn't match" };
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: string; plan?: string; exp?: number };
    if (p.exp && Date.now() > p.exp) return { valid: false, reason: "expired" };
    return { valid: true, plan: String(p.plan ?? "pro"), sub: String(p.sub ?? "") };
  } catch {
    return { valid: false, reason: "unreadable key" };
  }
}

export function readLicense(home: string, env: NodeJS.ProcessEnv = process.env): License {
  const fromEnv = env.BUILDPILOT_LICENSE_KEY || env.BUILDPILOT_AUTH_TOKEN;
  if (fromEnv) return { ...verifyKey(fromEnv), source: "env" };
  const key = readJson<{ key: string }>(licensePath(home)).key;
  if (typeof key === "string" && key) return { ...verifyKey(key), source: "file" };
  return { valid: false, reason: "no key" };
}

/** Validates then saves the key to <home>/license.json. Returns the verdict; invalid keys are not saved. */
export function saveLicense(home: string, key: string): License {
  const v = verifyKey(key);
  if (v.valid) writeJson(licensePath(home), { key: key.trim() });
  return v;
}

export function checkoutUrl(installId: string, env: NodeJS.ProcessEnv = process.env): string {
  const u = new URL(env.BUILDPILOT_CHECKOUT_URL || CHECKOUT_URL);
  u.searchParams.set("client_reference_id", installId);
  return u.toString();
}

export function gate(home: string, env: NodeJS.ProcessEnv = process.env): Gate {
  if (readLicense(home, env).valid) return { allowed: true, licensed: true, remaining: null };
  const u = readUsage(home);
  if (u.count < FREE_PROMPTS) return { allowed: true, licensed: false, remaining: FREE_PROMPTS - u.count };
  const url = checkoutUrl(u.installId, env);
  return { allowed: false, paywall: { url, used: u.count, limit: FREE_PROMPTS, message: `🔴 Free limit reached. Upgrade to unlock unlimited premium generations: ${url}` } };
}

/** Call only after a prompt was generated successfully. No-op when licensed. */
export function recordUse(home: string, env: NodeJS.ProcessEnv = process.env): number | null {
  if (readLicense(home, env).valid) return null;
  const u = readUsage(home);
  u.count += 1;
  writeJson(usagePath(home), u);
  return Math.max(0, FREE_PROMPTS - u.count);
}

/** Terminal paywall: short and scannable. */
export function paywallText(p: Paywall): string {
  return [
    p.message,
    "",
    `  You've used all ${p.limit} free Prompt Studio prompts. Pro = unlimited, plus everything else stays free.`,
    "  Already paid?  bp license <your-key>",
  ].join("\n");
}
