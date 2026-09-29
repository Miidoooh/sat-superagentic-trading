import { describe, expect, it } from "vitest";
import { candlesFromPricePoints } from "../src/lib/data/candles";
import { sanitizePricePoints } from "../src/lib/data/chainlink";
import { sqrtToPrice } from "../src/lib/data/pools";

describe("sanitizePricePoints", () => {
  it("drops rounds published on the wrong decimal scale", () => {
    // Shape of the real SPY feed: early bring-up rounds came back 1e10 too large.
    const points = [
      { time: 1, price: 742.44e10 },
      { time: 2, price: 746.16e10 },
      ...Array.from({ length: 20 }, (_, i) => ({ time: 10 + i, price: 750 + i })),
    ];
    const clean = sanitizePricePoints(points);
    expect(clean).toHaveLength(20);
    expect(Math.max(...clean.map((p) => p.price))).toBeLessThan(1000);
  });

  it("keeps genuine volatility", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ time: i, price: 100 * (1 + i * 0.08) }));
    expect(sanitizePricePoints(points)).toHaveLength(30);
  });

  it("leaves very short series untouched", () => {
    const points = [{ time: 1, price: 1 }, { time: 2, price: 999_999 }];
    expect(sanitizePricePoints(points)).toHaveLength(2);
  });
});

const HOUR = 3600;

describe("candlesFromPricePoints", () => {
  it("builds one candle per bucket with correct OHLC", () => {
    const base = 1_700_000_000;
    const candles = candlesFromPricePoints(
      [
        { time: base + 10, price: 100 },
        { time: base + 200, price: 110 },
        { time: base + 300, price: 95 },
        { time: base + HOUR + 10, price: 105 },
      ],
      HOUR,
    );
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 95, close: 95, volume: 0 });
    // The previous close carries into the next candle's open.
    expect(candles[1]).toMatchObject({ open: 95, high: 105, low: 95, close: 105 });
  });

  it("aligns candle times to bucket boundaries", () => {
    const candles = candlesFromPricePoints([{ time: 1_700_003_601, price: 5 }], HOUR);
    expect(candles[0].time % HOUR).toBe(0);
  });

  it("carries a flat candle across short gaps", () => {
    const base = 1_700_000_000;
    const candles = candlesFromPricePoints(
      [
        { time: base, price: 10 },
        { time: base + 3 * HOUR, price: 12 },
      ],
      HOUR,
    );
    expect(candles).toHaveLength(4);
    expect(candles[1]).toMatchObject({ open: 10, high: 10, low: 10, close: 10 });
    expect(candles[3].close).toBe(12);
  });

  it("does not invent data across long gaps", () => {
    const base = 1_700_000_000;
    const candles = candlesFromPricePoints(
      [
        { time: base, price: 10 },
        { time: base + 40 * HOUR, price: 12 },
      ],
      HOUR,
    );
    expect(candles).toHaveLength(2);
  });

  it("ignores non-positive prices and handles empty input", () => {
    expect(candlesFromPricePoints([], HOUR)).toEqual([]);
    expect(candlesFromPricePoints([{ time: 1, price: 0 }], HOUR)).toEqual([]);
  });

  it("sorts unordered input before bucketing", () => {
    const base = 1_700_000_000;
    const candles = candlesFromPricePoints(
      [
        { time: base + 500, price: 20 },
        { time: base + 100, price: 10 },
      ],
      HOUR,
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ open: 10, close: 20 });
  });
});

describe("sqrtToPrice", () => {
  const ref = {
    pool: "0x0000000000000000000000000000000000000001" as const,
    token: "0x0000000000000000000000000000000000000002" as const,
    tokenDecimals: 18,
    quote: { address: "0x0000000000000000000000000000000000000003", symbol: "USDG", decimals: 6, kind: "stable" as const },
    feeTier: 3000,
    tokenIsToken0: true,
  };

  /** sqrtPriceX96 for a raw token1/token0 ratio. */
  const sqrtFor = (rawRatio: number) => BigInt(Math.floor(Math.sqrt(rawRatio) * 2 ** 96));

  it("prices an 18-decimal token against a 6-decimal stable", () => {
    // $350 per token means 350e6 quote units per 1e18 token units.
    const raw = (350 * 1e6) / 1e18;
    expect(sqrtToPrice(sqrtFor(raw), ref)).toBeCloseTo(350, 4);
  });

  it("inverts when the Stock Token is token1", () => {
    const raw = 1e18 / (350 * 1e6);
    expect(sqrtToPrice(sqrtFor(raw), { ...ref, tokenIsToken0: false })).toBeCloseTo(350, 4);
  });

  it("handles an 18-decimal quote such as WETH", () => {
    const weth = { address: "0x0000000000000000000000000000000000000004", symbol: "WETH", decimals: 18, kind: "native" as const };
    expect(sqrtToPrice(sqrtFor(0.125), { ...ref, quote: weth })).toBeCloseTo(0.125, 6);
  });
});
