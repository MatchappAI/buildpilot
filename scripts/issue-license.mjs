#!/usr/bin/env node
// Mint a BuildPilot Pro key. The private key lives outside the repo: ~/.buildpilot-issuer/private.pem
// Usage: node scripts/issue-license.mjs <subject> [plan] [days]   (no days = never expires)
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const [sub, plan = "pro", days] = process.argv.slice(2);
if (!sub) { console.error("Usage: node scripts/issue-license.mjs <subject> [plan] [days]"); process.exit(1); }
const keyFile = process.env.BUILDPILOT_ISSUER_KEY || path.join(os.homedir(), ".buildpilot-issuer", "private.pem");
const priv = crypto.createPrivateKey(fs.readFileSync(keyFile));
const payload = { sub, plan, iat: Date.now(), ...(days ? { exp: Date.now() + Number(days) * 86_400_000 } : {}) };
const body = `BP1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
console.log(`${body}.${crypto.sign(null, Buffer.from(body), priv).toString("base64url")}`);
