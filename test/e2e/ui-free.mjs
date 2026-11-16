import fs from "fs"; import path from "path";
import { launch } from "./cdp.mjs"; import { makeEnv } from "./env.mjs";
process.env.BUILDPILOT_CHECKOUT_URL = "https://buy.stripe.com/test_example"; process.env.BUILDPILOT_TRIAL_DAYS = "0";
const E = makeEnv(); const res = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const step = async (n, f) => { try { res.push(["PASS", n, (await f()) ?? ""]); } catch (e) { res.push(["FAIL", n, e.message.slice(0, 200)]); } };
E.cli(["hooks", "install"]);
const usage = () => { try { return JSON.parse(fs.readFileSync(path.join(E.home, ".buildpilot/usage.json"), "utf8")).count; } catch { return 0; } };
const { url } = await E.startUi(); const b = await launch();
try {
  await b.goto(url); await b.wait(() => !!document.getElementById("req"), 10000);
  await step("free plan shown", async () => (await b.text()).match(/free|Pro/i)?.[0]);
  await b.type("#req", "add a contact form"); await b.click('[data-act="build"]'); await b.wait(() => (document.getElementById("ptext")?.value ?? "").length > 100, 8000);
  const u0 = usage();
  await step("writing a prompt doesn't count it", async () => { ok(usage() === u0, `${u0} -> ${usage()}`); return `count ${u0}`; });
  await step("cancelled Start doesn't count", async () => { await b.click('[data-act="sendPrompt"]'); await b.wait(() => !!document.querySelector(".bp-modal [data-x]")); await b.click(".bp-modal [data-x]"); await new Promise((r) => setTimeout(r, 800)); ok(usage() === u0, `${u0} -> ${usage()}`); });
  await step("confirmed Start counts once", async () => { await b.click('[data-act="sendPrompt"]'); await b.wait(() => !!document.querySelector(".bp-modal [data-ok]")); await b.click(".bp-modal [data-ok]"); await b.wait(() => /starting/i.test(document.getElementById("flash").textContent), 6000); await new Promise((r) => setTimeout(r, 800)); ok(usage() === u0 + 1, `${u0} -> ${usage()}`); return `count ${usage()}`; });
  await step("upgrade opens checkout with install id (logged, not opened)", async () => { const has = await b.eval(() => !!document.querySelector('[data-act="upgrade"]')); if (!has) return "no upgrade button visible on this state"; await b.click('[data-act="upgrade"]'); await new Promise((r) => setTimeout(r, 800)); const o = E.osLog().find((x) => x.kind === "open"); ok(o && /buy\.stripe\.com\/test_example\?client_reference_id=/.test(o.url), JSON.stringify(o)); return o.url.replace(/=.*/, "=…"); });
  await step("invalid license key → plain error, nothing saved", async () => { const has = await b.eval(() => !!document.querySelector('[data-act="enterLicense"]')); if (!has) return "no key button visible"; await b.click('[data-act="enterLicense"]'); await b.wait(() => !!document.querySelector(".bp-modal input")); await b.eval(() => { document.querySelector(".bp-modal input").value = "BP1.abc.def"; }); await b.click(".bp-modal [data-ok]"); await b.wait(() => /didn't work/.test(document.getElementById("flash").textContent), 6000); ok(!fs.existsSync(path.join(E.home, ".buildpilot/license.json")), "saved"); return await b.eval(() => document.getElementById("flash").textContent); });
  await step("no console errors", async () => { ok(!b.errors().length, b.errors().join()); });
} finally { await b.close(); E.cleanup(); }
for (const r of res) console.log(r.join("  "));
if (res.some((r) => r[0] === "FAIL")) process.exitCode = 1;
