import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { accuracyText, billingOf, forecastFullAt, gradeWindow, recentStatuses, recordForecast, recordLimitSample } from "../../src/core/page";
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
    expect(t[0]).toMatchObject({ key: "memory", action: "startFresh", cwd: "/p/shop" });
    expect(t[0]!.text).toMatch(/chat is 91% full/);
  });

  it("limit soon (forecast < 1 h or ≥85%) → limit tip", () => {
    expect(tips({ ...base, limits: { ...base.limits, fiveHourPct: 87 } })[0]!.key).toBe("limit");
    expect(tips({ ...base, limits: { ...base.limits, fullAt: base.now + 30 * 60_000 } })[0]!.text).toMatch(/You've used 20% of your 5-hour limit/);
    const lt = tips({ ...base, builds: [b({}), b({ id: "y", folder: "blog", cwd: "/p/blog" })], limits: { ...base.limits, fiveHourPct: 90 }, biggest: { folder: "shop", share: 61, cwd: "/p/shop" } })[0]!;
    expect(lt.text).toMatch(/shop is using 61% of your usage today; pause it/);
    expect(lt).toMatchObject({ action: "pause", cwd: "/p/shop" });
  });

  it("two builds in one folder → new build tip; no git → undo tip; many unsaved → save point", () => {
    expect(tips({ ...base, builds: [b({}), b({ id: "y" })] }).map((t) => t.key)).toContain("overlap");
    expect(tips({ ...base, isGit: false })[0]).toMatchObject({ key: "nogit", action: "setupUndo" });
    expect(tips({ ...base, unsaved: 20 })[0]).toMatchObject({ key: "unsaved", action: "checkpoint" });
  });

  it("stuck loop → plan tip, and never more than 3 tips", () => {
    const t = tips({ ...base, stuck: ["Same error 4 times"], builds: [b({ contextPct: 95 }), b({ id: "y" })], limits: { ...base.limits, fiveHourPct: 95, sevenDayPct: 95 }, unsaved: 30 });
    expect(t.length).toBe(3);
    expect(t.map((x) => x.key)).toContain("stuck");
  });
});

describe("forecast accuracy", () => {
  it("grades a finished window: forecasts 20–90 min before the hit vs the real hit time", () => {
    const t0 = 1_000_000_000_000;
    const f = { resetsAt: t0 + 5 * 3600_000, samples: [[t0, 50], [t0 + 60 * 60_000, 80], [t0 + 120 * 60_000, 99]] as [number, number][], forecasts: [[t0 + 60 * 60_000, t0 + 130 * 60_000], [t0 + 80 * 60_000, t0 + 110 * 60_000]] as [number, number][] };
    const g = gradeWindow(f, t0 + 300 * 60_000)!;
    expect(g).toMatchObject({ hit: true, falseAlarm: false });
    expect(g.errorMin).toBe(10); // |130-120| and |110-120| → 10 min
    expect(accuracyText([g])).toBe("Past forecasts were off by about 10 min (1 window).");
    expect(accuracyText([])).toBeNull();
  });

  it("a new window grades the old one and keeps history; a predicted-but-never-hit window is a false alarm", () => {
    const home = tmpDir();
    const t0 = 1_000_000_000_000;
    const reset1 = t0 + 2 * 3600_000;
    let f = recordLimitSample(home, 70, reset1, t0);
    recordForecast(home, f, t0 + 30 * 60_000, t0);
    f = recordLimitSample(home, 75, reset1, t0 + 10 * 60_000);
    f = recordLimitSample(home, 2, reset1 + 5 * 3600_000, reset1 + 60_000); // new window
    expect(f.samples).toEqual([[reset1 + 60_000, 2]]);
    expect(f.history?.[0]).toMatchObject({ hit: false, falseAlarm: true });
  });
});
