import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

/**
 * Optional anonymous product counts. OFF until the user says yes (asked once, on the page).
 * Exactly four events, each sent at most once per install, with a random id used only for counts (not the checkout id):
 * no project names, paths, prompts, code or IPs stored. See docs/SECURITY.md.
 */
export const COUNT_EVENTS = ["installed", "connected", "day7", "upgraded"] as const;
export type CountEvent = (typeof COUNT_EVENTS)[number];
/** The license Worker's live /v1/count route. Nothing is sent unless the user said yes (consent in counts.json). */
export const COUNT_URL = "https://buildpilot-license.gupta-mohil.workers.dev/v1/count";

interface CountsFile { consent?: boolean; firstSeen?: number; id?: string; sent?: Partial<Record<CountEvent, number>> }
const file = (home: string) => path.join(home, "counts.json");

export function readCounts(home: string): CountsFile {
  try {
    return JSON.parse(fs.readFileSync(file(home), "utf8")) as CountsFile;
  } catch {
    return {};
  }
}

function write(home: string, c: CountsFile): void {
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(file(home), JSON.stringify(c, null, 2), { mode: 0o600 });
  } catch {
    /* read-only home: nothing is sent */
  }
}

/** true = ask the user (never answered). */
export const shouldAsk = (home: string) => readCounts(home).consent === undefined;

export function setConsent(home: string, yes: boolean, now = Date.now()): void {
  const c = readCounts(home);
  write(home, { ...c, consent: yes, firstSeen: c.firstSeen ?? now });
}

/** Sends one event if (and only if) the user said yes, the endpoint is configured, and it wasn't sent before. */
export async function count(home: string, ev: CountEvent, opts: { url?: string; now?: number; fetchFn?: typeof fetch } = {}): Promise<boolean> {
  const url = opts.url ?? process.env.BUILDPILOT_COUNT_URL ?? COUNT_URL;
  const now = opts.now ?? Date.now();
  const c = readCounts(home);
  if (!c.firstSeen || !c.id) write(home, ((c.firstSeen = c.firstSeen ?? now), (c.id = c.id ?? randomUUID()), c));
  if (c.consent !== true || url.includes("REPLACE") || c.sent?.[ev]) return false;
  if (ev === "day7" && now - (c.firstSeen ?? now) < 7 * 86_400_000) return false;
  try {
    const r = await (opts.fetchFn ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: ev, id: c.id }), signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    write(home, { ...c, sent: { ...c.sent, [ev]: now } });
    return true;
  } catch {
    return false;
  }
}
