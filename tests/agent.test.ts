import { describe, expect, it } from "vitest";
import {
  checkExit,
  describePlan,
  flagCopycats,
  matchPicks,
  planFor,
  rejectReason,
  STYLE_PRESETS,
  StrategySchema,
  type Candidate,
  type TrackedPosition,
} from "@/lib/agent/strategy";
import { mergeTrack, trackStats } from "@/lib/agent/track";
import { formatPick } from "@/lib/telegram/telegram";

const NOW = 1_800_000_000;
const tok = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;

const launch = (over: Partial<Candidate> = {}): Candidate => ({
  token: tok(1),
  symbol: "PEPE",
  name: "Pepe",
  socials: { x: "https://x.com/pepe", telegram: null, website: null, discord: null, other: [] } as never,
  launchedAt: NOW - 5 * 60,
  graduatedAt: null,
  priceUsd: 0.000008,
  mcapUsd: 8_000,
  progressPct: 12,
  vol30mUsd: 2_000,
  net30mUsd: 600,
  traders30m: 20,
  url: "https://pons.family/token/x",
  ...over,
});

describe("style filters", () => {
  const sniper = STYLE_PRESETS.sniper;

  it("accepts a fresh, busy launch inside the market cap range", () => {
    expect(rejectReason(sniper, launch(), NOW)).toBeNull();
  });

  it("says exactly why a launch does not fit", () => {
    expect(rejectReason(sniper, launch({ mcapUsd: 40_000 }), NOW)).toBe("mcap too high");
    expect(rejectReason(sniper, launch({ launchedAt: NOW - 3 * 3600 }), NOW)).toBe("too old");
    expect(rejectReason(sniper, launch({ traders30m: 2 }), NOW)).toBe("too few traders");
    expect(rejectReason(sniper, launch({ socials: undefined }), NOW)).toBe("no socials");
    expect(rejectReason(sniper, launch({ graduatedAt: NOW - 60 }), NOW)).toBe("graduated");
  });

  it("ranks the stronger launch first and drops the ones that fail", () => {
    const weak = launch({ token: tok(2), symbol: "WEAK", net30mUsd: 150, traders30m: 9, vol30mUsd: 400 });
    const strong = launch({ token: tok(3), symbol: "STRONG", net30mUsd: 4_000, traders30m: 80, vol30mUsd: 20_000 });
    const old = launch({ token: tok(4), symbol: "OLD", launchedAt: NOW - 86_400 });
    const picks = matchPicks(sniper, [weak, strong, old], NOW);
    expect(picks.map((p) => p.symbol)).toEqual(["STRONG", "WEAK"]);
    expect(picks[0].score).toBeGreaterThan(picks[1].score);
    expect(picks[0].reasons.join(" ")).toContain("80 wallets traded it in 30m");
  });

  it("only keeps safety-checked launches when the style sets a minimum", () => {
    const s = { ...STYLE_PRESETS.sniper, minSafety: 60 };
    const a = launch({ token: tok(5), symbol: "SAFE" });
    const b = launch({ token: tok(6), symbol: "RISKY" });
    const safety = new Map([
      [tok(5), { score: 80, label: "Lower risk" }],
      [tok(6), { score: 30, label: "High risk" }],
    ]);
    expect(matchPicks(s, [a, b], NOW, { safety }).map((p) => p.symbol)).toEqual(["SAFE"]);
  });
});

describe("plans", () => {
  it("turns take-profit multiples and the stop into market caps", () => {
    const p = planFor(STYLE_PRESETS.sniper, 10_000, 0.00001);
    expect(p.targets.map((t) => [t.atX, t.sellPct, t.mcap])).toEqual([
      [2, 50, 20_000],
      [5, 50, 50_000],
    ]);
    expect(p.stop.mcap).toBe(6_000);
    expect(describePlan(p)).toContain("Stop at $6.0K (−40%)");
  });

  it("validates styles at the boundary", () => {
    expect(StrategySchema.safeParse({ ...STYLE_PRESETS.momentum, stopLossPct: 0 }).success).toBe(false);
    expect(StrategySchema.safeParse({ ...STYLE_PRESETS.momentum, takeProfits: [] }).success).toBe(false);
    expect(StrategySchema.safeParse(STYLE_PRESETS.graduation).success).toBe(true);
  });
});

describe("exit signals", () => {
  const position = (over: Partial<TrackedPosition> = {}): TrackedPosition => ({
    token: tok(1),
    symbol: "PEPE",
    openedAt: NOW - 600,
    plan: planFor({ ...STYLE_PRESETS.momentum, maxHoldHours: 2 }, 10_000, 0.00001),
    hit: [],
    peakMcap: 10_000,
    ...over,
  });

  it("takes profit once per target, then sells the rest at the next one", () => {
    const first = checkExit(position(), 15_500, NOW);
    expect(first).toMatchObject({ kind: "take-profit", target: 0, sellPct: 50 });
    expect(checkExit(position({ hit: [0] }), 15_500, NOW)).toBeNull();
    expect(checkExit(position({ hit: [0] }), 31_000, NOW)).toMatchObject({ kind: "take-profit", target: 1, sellPct: 50 });
    expect(checkExit(position({ hit: [0, 1] }), 99_000, NOW)).toBeNull();
  });

  it("stops out below the stop, selling whatever is left", () => {
    expect(checkExit(position({ hit: [0] }), 7_400, NOW)).toMatchObject({ kind: "stop-loss", sellPct: 50 });
  });

  it("trails from the peak once in profit", () => {
    expect(checkExit(position({ hit: [0], peakMcap: 25_000 }), 19_500, NOW)).toMatchObject({ kind: "trailing" });
    expect(checkExit(position({ peakMcap: 10_000 }), 9_000, NOW)).toBeNull();
  });

  it("exits on the time limit", () => {
    expect(checkExit(position({ openedAt: NOW - 3 * 3600 }), 11_000, NOW)).toMatchObject({ kind: "time", sellPct: 100 });
  });
});

describe("telegram pick message", () => {
  it("carries the plan, any warning and a link to buy, with names escaped", () => {
    const [pick] = matchPicks(STYLE_PRESETS.sniper, [launch({ symbol: "<B>" })], NOW);
    const text = formatPick({ ...pick, warnings: ["Copycat ticker"] }, "Sniper & co", "https://sathood.xyz");
    expect(text).toContain("New pick for Sniper &amp; co: &lt;B&gt;");
    expect(text).toContain("sell 50% at $16.0K (2×), 50% at $40.0K (5×)");
    expect(text).toContain("Stop at $4.8K (−40%)");
    expect(text).toContain("⚠️ Copycat ticker");
    expect(text).toContain(`https://sathood.xyz/app?token=${tok(1)}`);
  });
});

describe("copycats and track record", () => {
  it("flags a ticker that an earlier launch already used", () => {
    const original = launch({ token: tok(7), symbol: "EKWH", launchedAt: NOW - 900 });
    const copy = launch({ token: tok(8), symbol: "EKWH", launchedAt: NOW - 120 });
    const picks = matchPicks(STYLE_PRESETS.sniper, [original, copy], NOW);
    const flagged = flagCopycats(picks, [original, copy]);
    expect(flagged.find((p) => p.token === tok(8))?.warnings[0]).toContain("Copycat ticker");
    expect(flagged.find((p) => p.token === tok(7))?.warnings).toEqual([]);
  });

  it("logs each pick once per day and scores it by its peak", () => {
    const [pick] = matchPicks(STYLE_PRESETS.sniper, [launch()], NOW);
    let track = mergeTrack([], [pick], new Map(), NOW);
    track = mergeTrack(track, [pick], new Map([[tok(1), 24_000]]), NOW + 600);
    track = mergeTrack(track, [], new Map([[tok(1), 12_000]]), NOW + 1200);
    expect(track).toHaveLength(1);
    expect(track[0]).toMatchObject({ entryMcap: 8_000, peakMcap: 24_000, lastMcap: 12_000 });
    const stats = trackStats("sniper", track, NOW + 1200);
    expect(stats).toMatchObject({ picks: 1, hit2x: 1, hit5x: 0, winRatePct: 100 });
    expect(stats.best?.x).toBe(3);
  });
});
