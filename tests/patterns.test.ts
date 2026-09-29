import { describe, expect, it } from "vitest";
import { analyzeChart } from "../src/lib/analysis/analyze";
import { detectBreakout, detectDoubles, detectMaCross, detectPatterns, detectRsiExtreme } from "../src/lib/analysis/patterns";
import { findLevels } from "../src/lib/analysis/levels";
import { fromCloses, linear } from "./helpers";

describe("patterns", () => {
  it("detects a volume-confirmed range breakout", () => {
    const closes = [...Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 0.5), 106];
    const candles = fromCloses(closes, { volume: (i) => (i === closes.length - 1 ? 5000 : 1000) });
    const hits = detectBreakout(candles, 3);
    expect(hits.map((h) => h.id)).toContain("breakout_up");
    expect(hits[0].confidence).toBeGreaterThan(0.6);
  });

  it("detects a range breakdown", () => {
    const closes = [...Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 0.5), 94];
    expect(detectBreakout(fromCloses(closes), 3).map((h) => h.id)).toContain("breakdown");
  });

  it("flags RSI overbought after a relentless rally", () => {
    const hits = detectRsiExtreme(fromCloses(linear(50, 120, 60)));
    expect(hits[0]?.id).toBe("rsi_overbought");
    expect(hits[0]?.direction).toBe("bearish");
  });

  it("detects a golden cross when SMA20 overtakes SMA50", () => {
    // long decline then sharp recovery
    const closes = [...linear(150, 100, 60), ...linear(100, 160, 40)];
    const candles = fromCloses(closes);
    const found = detectMaCross(candles, candles.length).find((s) => s.id === "golden_cross");
    expect(found).toBeDefined();
  });

  it("detects a confirmed double top", () => {
    // rise to 120, dip to 100, rise to ~120, then close below 100
    const closes = [
      ...linear(100, 120, 15),
      ...linear(120, 100, 12).slice(1),
      ...linear(100, 119.5, 12).slice(1),
      ...linear(119.5, 95, 14).slice(1),
    ];
    const candles = fromCloses(closes);
    const hits = detectDoubles(candles, candles.length);
    expect(hits.map((h) => h.id)).toContain("double_top");
  });

  it("returns nothing for tiny series", () => {
    expect(detectPatterns(fromCloses(linear(1, 2, 10)))).toEqual([]);
  });

  it("clusters repeated pivots into support/resistance", () => {
    const wave = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 3));
    const levels = findLevels(fromCloses(wave));
    expect(levels.some((l) => l.kind === "resistance" && l.touches >= 2)).toBe(true);
    expect(levels.some((l) => l.kind === "support" && l.touches >= 2)).toBe(true);
  });
});

describe("analyzeChart", () => {
  it("classifies a steady climb as bullish", () => {
    const a = analyzeChart(fromCloses(linear(100, 200, 120)), "1h");
    expect(a.trend.direction).toBe("bullish");
    expect(a.summary).toContain("bullish");
  });

  it("classifies a steady decline as bearish", () => {
    const a = analyzeChart(fromCloses(linear(200, 100, 120)), "1h");
    expect(a.trend.direction).toBe("bearish");
  });

  it("throws on empty input", () => {
    expect(() => analyzeChart([], "1h")).toThrow();
  });
});
