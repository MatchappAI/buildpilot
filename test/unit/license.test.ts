import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { checkoutUrl, FREE_PROMPTS, gate, paywallText, readLicense, recordUse, saveLicense, verifyKey } from "../../src/core/license";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bp-lic-"));
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
const mint = (p: object, k = privateKey) => {
  const body = `BP1.${Buffer.from(JSON.stringify(p)).toString("base64url")}`;
  return `${body}.${crypto.sign(null, Buffer.from(body), k).toString("base64url")}`;
};

describe("license gate", () => {
  it("allows 20 free prompts, then shows the paywall with the install id", () => {
    const home = tmp();
    const env = {};
    for (let i = 0; i < FREE_PROMPTS; i++) {
      expect(gate(home, env).allowed).toBe(true);
      recordUse(home, env);
    }
    const g = gate(home, env);
    expect(g.allowed).toBe(false);
    if (g.allowed) return;
    const id = JSON.parse(fs.readFileSync(path.join(home, "usage.json"), "utf8")).installId;
    expect(g.paywall.message.startsWith("🔴 Free limit reached. Upgrade to unlock unlimited premium generations: https://")).toBe(true);
    expect(g.paywall.url).toContain(`client_reference_id=${id}`);
    expect(paywallText(g.paywall)).toContain("bp license");
  });

  it("checkout link can be overridden by env", () => {
    expect(checkoutUrl("abc12345", { BUILDPILOT_CHECKOUT_URL: "https://buy.stripe.com/test_x" })).toBe("https://buy.stripe.com/test_x?client_reference_id=abc12345");
  });

  it("verifies signed keys and rejects forged, tampered or expired ones", () => {
    expect(verifyKey(mint({ sub: "me", plan: "pro" }), pub)).toMatchObject({ valid: true, sub: "me" });
    const other = crypto.generateKeyPairSync("ed25519").privateKey;
    expect(verifyKey(mint({ sub: "me" }, other), pub).valid).toBe(false);
    const k = mint({ sub: "me" });
    expect(verifyKey(k.replace("BP1.e", "BP1.f"), pub).valid).toBe(false);
    expect(verifyKey(mint({ sub: "me", exp: Date.now() - 1 }), pub)).toMatchObject({ valid: false, reason: "expired" });
    expect(verifyKey("anything-goes", pub).valid).toBe(false);
  });

  it("an invalid key in env or file never bypasses the counter", () => {
    const home = tmp();
    expect(readLicense(home, { BUILDPILOT_LICENSE_KEY: "BP1.abc.def" }).valid).toBe(false);
    expect(saveLicense(home, "BP1.abc.def").valid).toBe(false);
    expect(fs.existsSync(path.join(home, "license.json"))).toBe(false);
    recordUse(home, {});
    expect(gate(home, { BUILDPILOT_AUTH_TOKEN: "nope" })).toMatchObject({ allowed: true, licensed: false, remaining: FREE_PROMPTS - 1 });
  });

  it("recovers from a corrupt usage file", () => {
    const home = tmp();
    fs.writeFileSync(path.join(home, "usage.json"), "{not json");
    expect(gate(home, {})).toMatchObject({ allowed: true, remaining: FREE_PROMPTS });
  });
});
