import { describe, expect, it } from "vitest";
import { ScanCriteriaSchema } from "../src/lib/scanner/criteria";
import { passesMarketFilters, scanTokens, unsupportedCriteria } from "../src/lib/scanner/scan";
import { SyntheticProvider } from "../src/lib/data/synthetic";
import type { MarketDataProvider } from "../src/lib/data/provider";
import type { TokenMarket } from "../src/lib/types";

const now = 1_800_000_000;
const market = (over: Partial<TokenMarket> = {}): TokenMarket => ({
  token: { address: "0x0000000000000000000000000000000000000001", symbol: "ABC", name: "Abc Token", decimals: 18 },
  poolAddress: "0x0000000000000000000000000000000000000002",
  feeTier: 3000,
  quoteSymbol: "USDG",
  priceUsd: 1,
  oraclePriceUsd: 1,
  oracleBasisPct: 0,
  oracleUpdatedAt: now,
  oracleStale: false,
  liquidityUsd: 100_000,
  volume24hUsd: 50_000,
  priceChange1hPct: 2,
  priceChange24hPct: 10,
  txCount24h: 100,
  createdAt: now - 10 * 86400,
  tradableNow: true,
  hasPriceHistory: true,
  venue: "uniswap-v3",
  ...over,
});

describe("scanner criteria", () => {
  it("rejects unknown keys (strict) so LLM typos surface as errors", () => {
    expect(() => ScanCriteriaSchema.parse({ minLiquidty: 5 })).toThrow();
  });

  it("applies defaults that every data source can satisfy", () => {
    const c = ScanCriteriaSchema.parse({});
    expect(c).toMatchObject({ timeframe: "4h", sortBy: "liquidity", limit: 10 });
  });
});

describe("market filters", () => {
  const c = (o: object) => ScanCriteriaSchema.parse(o);
  it("passes and fails on liquidity", () => {
    expect(passesMarketFilters(market(), c({ minLiquidityUsd: 50_000 }), now)).not.toBeNull();
    expect(passesMarketFilters(market(), c({ minLiquidityUsd: 200_000 }), now)).toBeNull();
  });
  it("filters by age window", () => {
    expect(passesMarketFilters(market(), c({ maxAgeDays: 5 }), now)).toBeNull();
    expect(passesMarketFilters(market(), c({ minAgeDays: 5, maxAgeDays: 30 }), now)).not.toBeNull();
  });
  it("filters by name", () => {
    expect(passesMarketFilters(market(), c({ symbolContains: "abc" }), now)).not.toBeNull();
    expect(passesMarketFilters(market(), c({ symbolContains: "zzz" }), now)).toBeNull();
  });
  it("fails closed when a filtered field is unavailable", () => {
    // A null value must never be treated as passing a numeric bound.
    expect(passesMarketFilters(market({ volume24hUsd: null }), c({ minVolume24hUsd: 1 }), now)).toBeNull();
    expect(passesMarketFilters(market({ createdAt: null }), c({ maxAgeDays: 1000 }), now)).toBeNull();
    expect(passesMarketFilters(market({ priceChange24hPct: null }), c({ minPriceChange24hPct: -99 }), now)).toBeNull();
  });
  it("ignores unavailable fields when they are not filtered on", () => {
    expect(passesMarketFilters(market({ volume24hUsd: null, createdAt: null }), c({}), now)).not.toBeNull();
  });
  it("filters on oracle basis and tradability", () => {
    expect(passesMarketFilters(market({ oracleBasisPct: -8 }), c({ maxOracleBasisPct: 5 }), now)).toBeNull();
    expect(passesMarketFilters(market({ oracleBasisPct: -2 }), c({ maxOracleBasisPct: 5 }), now)).not.toBeNull();
    expect(passesMarketFilters(market({ tradableNow: false }), c({ tradableNow: true }), now)).toBeNull();
  });
});

describe("capability gating", () => {
  /** Stands in for the mainnet provider: real pools, but no volume or token age. */
  const chainLike = {
    source: "robinhood-chain",
    supportedTimeframes: ["4h", "1d"],
    capabilities: { volume24h: false, txCount24h: false, tokenAge: false, priceHistory: true, liveTrading: true },
  } as unknown as MarketDataProvider;
  const problems = (input: object) => unsupportedCriteria(chainLike, ScanCriteriaSchema.parse(input));

  it("rejects volume filters and volume sorting", () => {
    expect(problems({ minVolume24hUsd: 10 }).join()).toMatch(/volume/);
    expect(problems({ sortBy: "volume24h" }).join()).toMatch(/volume/);
  });
  it("rejects token age filters", () => {
    expect(problems({ maxAgeDays: 5 }).join()).toMatch(/age/);
  });
  it("rejects a timeframe the source does not serve", () => {
    expect(problems({ rsiMax: 30, timeframe: "5m" }).join()).toMatch(/timeframe/);
  });
  it("allows supported criteria", () => {
    expect(problems({ minLiquidityUsd: 1000, rsiMax: 30, timeframe: "4h" })).toEqual([]);
    expect(problems({ patternsAny: ["breakout_up"], timeframe: "1d" })).toEqual([]);
  });
});

describe("scanTokens against the synthetic provider", () => {
  const provider = new SyntheticProvider();

  it("returns only tokens above the liquidity floor, sorted by the requested key", async () => {
    const r = await scanTokens(provider, { minLiquidityUsd: 500_000, sortBy: "volume24h" });
    expect(r.source).toBe("synthetic");
    expect(r.matches.length).toBeGreaterThan(0);
    for (const m of r.matches) expect(m.market.liquidityUsd).toBeGreaterThanOrEqual(500_000);
    const vols = r.matches.map((m) => m.market.volume24hUsd ?? 0);
    expect(vols).toEqual([...vols].sort((a, b) => b - a));
  });

  it("runs technical filters end to end", async () => {
    const r = await scanTokens(provider, { trend: "bullish", timeframe: "1h", limit: 12 });
    for (const m of r.matches) {
      expect(m.analysis?.trend.direction).toBe("bullish");
    }
  });

  it("rejects unsupported timeframes from limited providers", async () => {
    const limited = Object.create(provider, { supportedTimeframes: { value: ["1h"] } });
    await expect(scanTokens(limited, { rsiMax: 30, timeframe: "5m" })).rejects.toThrow(/not available/);
  });

  it("skips tokens that have no price history when running technical filters", async () => {
    const half = Object.create(provider, {
      listTokens: {
        value: async () => {
          const all = await provider.listTokens(50);
          return all.map((t, i) => ({ ...t, hasPriceHistory: i % 2 === 0 }));
        },
      },
    });
    const r = await scanTokens(half, { trend: "bullish", timeframe: "1h", limit: 50 });
    expect(r.matches.every((m) => m.market.hasPriceHistory)).toBe(true);
    expect(r.notes.some((n) => /no price history/.test(n))).toBe(true);
  });
});
