import { describe, expect, it } from "vitest";
import { atr, bollinger, ema, macd, rsi, sma } from "../src/lib/analysis/indicators";
import { linear } from "./helpers";

describe("indicators", () => {
  it("sma matches hand calculation", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(out.slice(2)).toEqual([2, 3, 4]);
  });

  it("ema seeds with sma and applies smoothing", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it("rsi is 100 on a monotonic rise and 0 on a monotonic fall", () => {
    expect(rsi(linear(1, 50, 40)).at(-1)).toBe(100);
    expect(rsi(linear(50, 1, 40)).at(-1)).toBeCloseTo(0, 6);
  });

  it("rsi matches a hand-computed Wilder value", () => {
    // Classic StockCharts sample series. Gains sum 3.34, losses sum 1.40 over 14 changes,
    // so RS = 3.34/1.40 and RSI = 100 - 100/(1+RS) = 70.46 (StockCharts shows 70.53 from rounded averages).
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    expect(rsi(closes)[14]).toBeCloseTo(100 - 100 / (1 + 3.34 / 1.4), 1);
  });

  it("macd histogram is positive in an accelerating uptrend", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5 + i * i * 0.02);
    const m = macd(closes);
    expect(m.histogram.at(-1)!).toBeGreaterThan(0);
    expect(m.macd.at(-1)!).toBeGreaterThan(0);
  });

  it("bollinger bands collapse on constant prices", () => {
    const b = bollinger(new Array(30).fill(10));
    expect(b.upper.at(-1)).toBe(10);
    expect(b.lower.at(-1)).toBe(10);
    expect(b.bandwidth.at(-1)).toBe(0);
  });

  it("atr equals constant range with no gaps", () => {
    const n = 30;
    const highs = new Array(n).fill(11);
    const lows = new Array(n).fill(9);
    const closes = new Array(n).fill(10);
    expect(atr(highs, lows, closes).at(-1)).toBeCloseTo(2, 10);
  });
});
