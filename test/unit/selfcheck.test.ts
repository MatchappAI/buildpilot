import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, HOOK_SCRIPT, installHooks, NEWER_EVENTS } from "../../src/core/hooks";
import { selfCheck } from "../../src/core/selfcheck";
import { tmpDir } from "./helpers";

describe("bp doctor", () => {
  it("reports without changing anything; --fix repairs the safe things", async () => {
    const home = tmpDir();
    const settings = path.join(tmpDir(), "settings.json");
    fs.writeFileSync(settings, "{}");
    installHooks(settings, home);
    // simulate an install from before the newer events existed + an old hook script
    const j = JSON.parse(fs.readFileSync(settings, "utf8"));
    for (const e of NEWER_EVENTS) delete j.hooks[e];
    fs.writeFileSync(settings, JSON.stringify(j));
    fs.writeFileSync(path.join(home, "hook.sh"), "#!/bin/sh\nexit 0\n");
    const before = fs.readFileSync(settings, "utf8");
    const r = await selfCheck({ home, settingsFile: settings });
    expect(r.fixed).toEqual([]);
    expect(fs.readFileSync(settings, "utf8")).toBe(before);
    expect(r.findings.filter((x) => !x.ok).map((x) => x.text).join("\n")).toMatch(/older connection[\s\S]*older version/);
    const r2 = await selfCheck({ home, settingsFile: settings, fix: true });
    expect(r2.fixed.length).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(home, "hook.sh"), "utf8")).toBe(HOOK_SCRIPT); // refreshed (by the reinstall or on its own)
    const after = JSON.parse(fs.readFileSync(settings, "utf8"));
    for (const e of HOOK_EVENTS) expect(after.hooks[e], e).toBeDefined();
  });
  it("says plainly when it isn't connected", async () => {
    const settings = path.join(tmpDir(), "settings.json");
    fs.writeFileSync(settings, "{}");
    const r = await selfCheck({ home: tmpDir(), settingsFile: settings });
    expect(r.findings.some((x) => !x.ok && /Not connected/.test(x.text))).toBe(true);
  });
});
