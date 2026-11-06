import { describe, expect, it } from "vitest";
import { count, readCounts, setConsent, shouldAsk } from "../../src/core/counts";
import { tmpDir } from "./helpers";

const URL_ = "https://w.example/v1/count";
const fakeFetch = () => {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fn };
};

describe("anonymous counts (opt-in)", () => {
  it("sends nothing until the user says yes", async () => {
    const home = tmpDir();
    const f = fakeFetch();
    expect(shouldAsk(home)).toBe(true);
    expect(await count(home, "installed", { url: URL_, fetchFn: f.fn })).toBe(false);
    setConsent(home, false);
    expect(shouldAsk(home)).toBe(false);
    expect(await count(home, "installed", { url: URL_, fetchFn: f.fn })).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it("after yes: each event once, payload is only {event, id}", async () => {
    const home = tmpDir();
    const f = fakeFetch();
    setConsent(home, true);
    expect(await count(home, "connected", { url: URL_, fetchFn: f.fn })).toBe(true);
    expect(await count(home, "connected", { url: URL_, fetchFn: f.fn })).toBe(false);
    expect(f.calls.length).toBe(1);
    expect(Object.keys(f.calls[0]!.body as object).sort()).toEqual(["event", "id"]);
    expect(readCounts(home).sent?.connected).toBeTypeOf("number");
  });

  it("day7 waits a week; placeholder endpoint never sends", async () => {
    const home = tmpDir();
    const f = fakeFetch();
    const t0 = 1_700_000_000_000;
    setConsent(home, true, t0);
    expect(await count(home, "day7", { url: URL_, fetchFn: f.fn, now: t0 + 86_400_000 })).toBe(false);
    expect(await count(home, "day7", { url: URL_, fetchFn: f.fn, now: t0 + 8 * 86_400_000 })).toBe(true);
    expect(await count(home, "upgraded", { url: "https://x.REPLACE.dev", fetchFn: f.fn })).toBe(false);
  });
});
