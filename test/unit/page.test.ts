import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { billingOf, forecastFullAt, recentStatuses, recordLimitSample } from "../../src/core/page";
import { tips, TipInput } from "../../src/core/tips";
import { readLiveStatus } from "../../src/core/hooks";
import { tmpDir } from "./helpers";

const writeStatus = (home: string, id: string, d: unknown) => {
  fs.mkdirSync(path.join(home, "status"), { recursive: true });
  fs.writeFileSync(path.join(home, "status", `${id}.json`), JSON.stringify(d));
};

describe("page data", () => {
  it("reads reset times (epoch seconds → ms) from the status line", () => {
    const home = tmpDir();
    writeStatus(home, "a", { rate_limits: { five_hour: { used_percentage: 40, resets_at: 1794000000 }, seven_day: { used_percentage: 12, resets_at: 1794500000 } } });
    const l = readLiveStatus("a", home)!;
    expect(l.fiveHourResetsAt).toBe(1794000000_000);
    expect(l.sevenDayResetsAt).toBe(1794500000_000);
  });

  it("billing: plan when rate limits are reported, api when only cost, unknown when nothing", () => {
    const home = tmpDir();
    expect(billingOf(recentStatuses(home, Date.now()))).toBe("unknown");
    writeStatus(home, "api", { cost: { total_cost_usd: 1.5 } });
    expect(billingOf(recentStatuses(home, Date.now()))).toBe("api");
    writeStatus(home, "plan", { rate_limits: { five_hour: { used_percentage: 5 } } });
    expect(billingOf(recentStatuses(home, Date.now()))).toBe("plan");
  });

  it("forecast: needs ≥3 samples over ≥10 min, predicts the 100% time, and says nothing if it resets first", () => {
    const home = tmpDir();
    const t0 = 1_000_000_000_000;
    const reset = t0 + 5 * 3600_000;
    recordLimitSample(home, 40, reset, t0);
    let f = recordLimitSample(home, 45, reset, t0 + 5 * 60_000);
    expect(forecastFullAt(f, t0 + 5 * 60_000)).toBeNull(); // too few / too short
    f = recordLimitSample(home, 50, reset, t0 + 10 * 60_000);
    const at = forecastFullAt(f, t0 + 10 * 60_000)!;
    // 1% per minute from 50% → ~50 minutes left
    expect(Math.round((at - (t0 + 10 * 60_000)) / 60_000)).toBe(50);
    // with a reset 20 minutes away, it resets before running out
    expect(forecastFullAt({ ...f, resetsAt: t0 + 30 * 60_000 }, t0 + 10 * 60_000)).toBeNull();
  });

  it("forecast: a new window (usage drops) starts a fresh series", () => {
    const home = tmpDir();
    recordLimitSample(home, 80, null, 1);
    recordLimitSample(home, 90, null, 120_001);
    const f = recordLimitSample(home, 3, null, 240_001);
    expect(f.samples).toEqual([[240_001, 3]]);
  });
});

describe("tips for right now", () => {
  const base: TipInput = { now: Date.now(), builds: [], limits: { fiveHourPct: 20, sevenDayPct: 10, fullAt: null, fiveHourResetsAt: null }, isGit: true, unsaved: 0, stuck: [] };
  const b = (o: object) => ({ id: "x", folder: "shop", cwd: "/p/shop", status: "running" as const, word: "working", reason: "", task: null, contextPct: 10, lastEventAt: Date.now(), needsYou: false, next: null, ...o });

  it("nothing to say when everything is fine", () => {
    expect(tips(base)).toEqual([]);
  });

  it("memory ≥80% → handoff tip with action", () => {
    const t = tips({ ...base, builds: [b({ contextPct: 91 })] });
    expect(t[0]).toMatchObject({ key: "memory", action: "handoff" });
    expect(t[0]!.text).toMatch(/91% full/);
  });

  it("limit soon (forecast < 1 h or ≥85%) → limit tip", () => {
    expect(tips({ ...base, limits: { ...base.limits, fiveHourPct: 87 } })[0]!.key).toBe("limit");
    expect(tips({ ...base, limits: { ...base.limits, fullAt: base.now + 30 * 60_000 } })[0]!.text).toMatch(/around/);
  });

  it("two builds in one folder → new build tip; no git → undo tip; many unsaved → save point", () => {
    expect(tips({ ...base, builds: [b({}), b({ id: "y" })] }).map((t) => t.key)).toContain("overlap");
    expect(tips({ ...base, isGit: false })[0]!.key).toBe("nogit");
    expect(tips({ ...base, unsaved: 20 })[0]).toMatchObject({ key: "unsaved", action: "checkpoint" });
  });

  it("stuck loop → plan tip, and never more than 3 tips", () => {
    const t = tips({ ...base, stuck: ["Same error 4 times"], builds: [b({ contextPct: 95 }), b({ id: "y" })], limits: { ...base.limits, fiveHourPct: 95, sevenDayPct: 95 }, unsaved: 30 });
    expect(t.length).toBe(3);
    expect(t.map((x) => x.key)).toContain("stuck");
  });
});
