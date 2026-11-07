/**
 * BuildPilot license Worker (Cloudflare). Three routes:
 *  POST /stripe/webhook  Stripe "checkout.session.completed" → mint a signed BP1 key, store it by session id
 *  GET  /success         thank-you page (Payment Link success URL) that shows the key with a Copy button
 *  POST /v1/count        optional anonymous product counts (installed | connected | day7 | upgraded)
 * Secrets: STRIPE_WEBHOOK_SECRET, LICENSE_PRIVATE_KEY (PKCS8 PEM, Ed25519). KV: LICENSES.
 * Keys verify offline in the extension (src/core/license.ts) with the matching public key.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
export interface Env { STRIPE_WEBHOOK_SECRET: string; STRIPE_WEBHOOK_SECRET_TEST?: string; LICENSE_PRIVATE_KEY: string; LICENSES: KV }

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Stripe signature check: HMAC-SHA256 over `${t}.${body}`, constant-time compare, 5-minute tolerance. */
export async function verifyStripe(body: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const v1s = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1s.length || Math.abs(nowSec - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)));
  return v1s.some((v) => v.length === want.length && [...v].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0);
}

function pemToDer(pem: string): ArrayBuffer {
  const b = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
}

/** Same format the extension verifies: BP1.<base64url(json)>.<base64url(ed25519 sig over "BP1.<payload>")>. */
export async function mintKey(privatePem: string, payload: { sub: string; plan: string; iat: number; exp?: number }): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privatePem), { name: "Ed25519" }, false, ["sign"]);
  const body = `BP1.${b64url(enc.encode(JSON.stringify(payload)))}`;
  return `${body}.${b64url(await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(body)))}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MARK = `<svg width="40" height="40" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="bpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C78FF"/><stop offset="1" stop-color="#1F3BC9"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bpg)"/><circle cx="256" cy="256" r="158" fill="none" stroke="#FFFFFF" stroke-opacity=".22" stroke-width="30"/><circle cx="256" cy="256" r="158" fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round" stroke-dasharray="700 993" transform="rotate(135 256 256)"/><path d="M176 200 L236 252 L176 304" fill="none" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><rect x="262" y="286" width="82" height="34" rx="17" fill="#FFFFFF"/></svg>`;
function page(inner: string, refresh = false): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="3">' : ""}<title>BuildPilot Pro</title>
<style>body{margin:0;background:#fafafa;color:#111;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}main{max-width:560px;margin:56px auto;padding:0 20px}.card{background:#fff;border:1px solid #e8e8e8;border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(16,24,40,.04)}.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:18px;margin-bottom:22px}.brand b{color:#3352e8}h1{font-size:24px;margin:0 0 8px;letter-spacing:-.01em}code{display:block;word-break:break-all;background:#f6f7fb;border:1px solid #e8e8ef;border-radius:10px;padding:14px;font:13px ui-monospace,Menlo,monospace;margin:14px 0}button{background:linear-gradient(180deg,#3352e8,#2242d8);color:#fff;border:0;border-radius:10px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(34,66,216,.3)}.muted{color:#6b6b6b;font-size:14px}ol{padding-left:20px}li{margin:4px 0}.spin{width:28px;height:28px;border-radius:50%;border:3px solid #e3e8fb;border-top-color:#3352e8;animation:s 1s linear infinite;margin-bottom:14px}@keyframes s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}}</style></head><body><main><div class="brand">${MARK}<span>Build<b>Pilot</b></span></div><div class="card">${inner}</div></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
}

const EVENTS = new Set(["installed", "connected", "day7", "upgraded"]);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/stripe/webhook") {
      const body = await req.text();
      // Live endpoint secret, plus (optionally) the test-mode endpoint's secret, so both modes can be wired at once.
      const sig = req.headers.get("stripe-signature");
      const ok = (await verifyStripe(body, sig, env.STRIPE_WEBHOOK_SECRET)) || (!!env.STRIPE_WEBHOOK_SECRET_TEST && (await verifyStripe(body, sig, env.STRIPE_WEBHOOK_SECRET_TEST)));
      if (!ok) return new Response("bad signature", { status: 400 });
      const ev = JSON.parse(body) as { type: string; data: { object: { id: string; client_reference_id?: string | null; payment_status?: string } } };
      if (ev.type !== "checkout.session.completed" || ev.data.object.payment_status === "unpaid") return new Response("ignored");
      const s = ev.data.object;
      if (await env.LICENSES.get(`session:${s.id}`)) return new Response("ok"); // Stripe retries: idempotent
      const key = await mintKey(env.LICENSE_PRIVATE_KEY, { sub: s.client_reference_id || s.id, plan: "pro", iat: Date.now() });
      await env.LICENSES.put(`session:${s.id}`, key);
      return new Response("ok");
    }
    if (req.method === "GET" && url.pathname === "/success") {
      const sid = url.searchParams.get("session_id") ?? "";
      if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sid)) return page("<h1>Thanks!</h1><p>We couldn't find your order on this link. Check your email receipt, or reply to it and we'll send your key.</p>");
      const key = await env.LICENSES.get(`session:${sid}`);
      if (!key) return page(`<div class=spin aria-hidden=true></div><h1>Thanks! Making your key…</h1><p class=muted>This usually takes a few seconds. This page refreshes by itself.</p><p class=muted id=slow hidden>Taking longer than usual? Keep this page open, or reply to your Stripe receipt email and we'll send your key.</p><script>setTimeout(function(){document.getElementById('slow').hidden=false},20000)</script>`, true);
      return page(`<h1>You're Pro 🎉</h1><p class=muted>Thanks for supporting BuildPilot. Here's your license key:</p><code id=k>${esc(key)}</code><button onclick="navigator.clipboard.writeText(document.getElementById('k').textContent);this.textContent='Copied ✓'">Copy key</button><ol class=muted><li>In BuildPilot, click <b>I have a license key</b> and paste it.</li><li>Or in a terminal: <b>bp license &lt;key&gt;</b> (in Claude Code: <b>/bp-license &lt;key&gt;</b>).</li></ol><p class=muted>Keep this key somewhere safe. Cancel anytime from your Stripe receipt email.</p>`);
    }
    if (req.method === "POST" && url.pathname === "/v1/count") {
      const b = (await req.json().catch(() => ({}))) as { event?: string; id?: string };
      if (!b.event || !EVENTS.has(b.event) || !b.id || !/^[A-Za-z0-9_-]{8,64}$/.test(b.id)) return new Response("bad request", { status: 400 });
      // One row per install per event (dedupes), no content, no IPs stored.
      await env.LICENSES.put(`count:${b.event}:${b.id}`, String(Date.now()), { expirationTtl: 400 * 86400 });
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  },
};
