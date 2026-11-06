import * as crypto from "crypto";
import { describe, expect, it } from "vitest";
import worker, { KV, mintKey, verifyStripe } from "../../server/src/index";
import { verifyKey } from "../../src/core/license";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const SECRET = "whsec_test";
const sign = (body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;
const kv = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) }; };
const env = () => ({ STRIPE_WEBHOOK_SECRET: SECRET, LICENSE_PRIVATE_KEY: PRIV, LICENSES: kv() });

describe("license worker", () => {
  it("mints keys the extension accepts", async () => {
    const k = await mintKey(PRIV, { sub: "install-123", plan: "pro", iat: 1 });
    expect(verifyKey(k, PUB)).toMatchObject({ valid: true, sub: "install-123", plan: "pro" });
  });

  it("verifies Stripe signatures and rejects bad / stale ones", async () => {
    const body = '{"a":1}';
    expect(await verifyStripe(body, sign(body), SECRET)).toBe(true);
    expect(await verifyStripe(body, sign('{"a":2}'), SECRET)).toBe(false);
    expect(await verifyStripe(body, sign(body, Math.floor(Date.now() / 1000) - 3600), SECRET)).toBe(false);
    expect(await verifyStripe(body, null, SECRET)).toBe(false);
  });

  it("checkout completed → key stored once → success page shows it; unknown session waits", async () => {
    const e = env();
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_abcdefgh123", client_reference_id: "install-xyz", payment_status: "paid" } } });
    const hook = () => worker.fetch(new Request("https://w/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sign(body) } }), e);
    expect((await hook()).status).toBe(200);
    const key = e.LICENSES.m.get("session:cs_test_abcdefgh123")!;
    expect(verifyKey(key, PUB)).toMatchObject({ valid: true, sub: "install-xyz" });
    await hook(); // Stripe retry
    expect(e.LICENSES.m.get("session:cs_test_abcdefgh123")).toBe(key);
    const ok = await (await worker.fetch(new Request("https://w/success?session_id=cs_test_abcdefgh123"), e)).text();
    expect(ok).toContain(key);
    const wait = await (await worker.fetch(new Request("https://w/success?session_id=cs_test_unknown123"), e)).text();
    expect(wait).toMatch(/refresh/);
    const bad = await worker.fetch(new Request("https://w/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=00" } }), e);
    expect(bad.status).toBe(400);
  });

  it("anonymous counts: only 4 known events with a random id; nothing else accepted", async () => {
    const e = env();
    const post = (b: unknown) => worker.fetch(new Request("https://w/v1/count", { method: "POST", body: JSON.stringify(b) }), e);
    expect((await post({ event: "connected", id: "abcd1234efgh" })).status).toBe(204);
    expect((await post({ event: "steal", id: "abcd1234efgh" })).status).toBe(400);
    expect((await post({ event: "connected", id: "../../etc" })).status).toBe(400);
    expect([...e.LICENSES.m.keys()]).toEqual(["count:connected:abcd1234efgh"]);
  });
});
