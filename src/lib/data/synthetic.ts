import type { Candle, ProviderCapabilities, Timeframe, TokenMarket } from "../types";
import { TIMEFRAME_SECONDS } from "../types";
import type { MarketDataProvider } from "./provider";
import { aggregateCandles } from "./aggregate";

/**
 * DEVELOPMENT ONLY. Deterministic synthetic market so the UI, scanner and
 * agent can be exercised without a live indexer. Every result produced from
 * this provider is tagged `source: "synthetic"` so it is never mistaken for
 * real Robinhood Chain data.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function fakeAddress(i: number): `0x${string}` {
  const hex = (i + 1).toString(16).padStart(4, "0");
  return `0x${"5a7".repeat(12)}${hex}`.slice(0, 42) as `0x${string}`;
}

interface Spec {
  symbol: string;
  name: string;
  basePrice: number;
  vol: number;
  drift: number;
  liquidity: number;
  ageDays: number;
}

const SPECS: Spec[] = [
  { symbol: "TSLA", name: "Tesla Stock Token", basePrice: 245, vol: 0.004, drift: 0.00002, liquidity: 2_400_000, ageDays: 120 },
  { symbol: "AAPL", name: "Apple Stock Token", basePrice: 212, vol: 0.0025, drift: 0.00001, liquidity: 3_100_000, ageDays: 120 },
  { symbol: "NVDA", name: "Nvidia Stock Token", basePrice: 128, vol: 0.005, drift: 0.00004, liquidity: 2_900_000, ageDays: 120 },
  { symbol: "AMZN", name: "Amazon Stock Token", basePrice: 189, vol: 0.003, drift: 0.00001, liquidity: 1_800_000, ageDays: 110 },
  { symbol: "HOOD", name: "Robinhood Markets Token", basePrice: 41, vol: 0.006, drift: 0.00005, liquidity: 950_000, ageDays: 90 },
  { symbol: "COIN", name: "Coinbase Stock Token", basePrice: 262, vol: 0.007, drift: -0.00001, liquidity: 700_000, ageDays: 80 },
  { symbol: "PLTR", name: "Palantir Stock Token", basePrice: 33, vol: 0.008, drift: 0.00006, liquidity: 520_000, ageDays: 60 },
  { symbol: "GME", name: "GameStop Stock Token", basePrice: 24, vol: 0.011, drift: -0.00002, liquidity: 260_000, ageDays: 45 },
  { symbol: "RHDOGE", name: "Robinhood Doge", basePrice: 0.0042, vol: 0.02, drift: 0.0001, liquidity: 85_000, ageDays: 6 },
  { symbol: "RHPEPE", name: "Robinhood Pepe", basePrice: 0.00031, vol: 0.025, drift: -0.0001, liquidity: 42_000, ageDays: 3 },
  { symbol: "SNOW", name: "Snow Protocol", basePrice: 1.7, vol: 0.012, drift: 0.00003, liquidity: 310_000, ageDays: 30 },
  { symbol: "DUST", name: "Dust Token", basePrice: 0.09, vol: 0.03, drift: -0.00005, liquidity: 6_500, ageDays: 2 },
];

const BAR = 300; // 5m base resolution
const BARS = 288 * 60; // 60 days of 5m bars
const NATIVE_USD = 3200;

export class SyntheticProvider implements MarketDataProvider {
  readonly source = "synthetic" as const;
  readonly supportedTimeframes: readonly Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];
  readonly capabilities: ProviderCapabilities = {
    volume24h: true,
    txCount24h: true,
    tokenAge: true,
    priceHistory: true,
    liveTrading: false,
  };
  private series = new Map<string, Candle[]>();
  private markets?: TokenMarket[];

  private base(index: number): Candle[] {
    const key = SPECS[index].symbol;
    const cached = this.series.get(key);
    if (cached) return cached;

    const spec = SPECS[index];
    const rand = mulberry32(0x9e3779b1 ^ (index * 7919));
    const end = Math.floor(Date.now() / 1000 / BAR) * BAR;
    const start = end - (BARS - 1) * BAR;
    const candles: Candle[] = [];

    // Simulate backwards-consistent path: walk forward, then rescale so the last close hits basePrice.
    let price = 1;
    let regime = 0;
    let regimeLeft = 0;
    let volState = 1;
    const baseVolume = spec.liquidity * 0.004;
    for (let i = 0; i < BARS; i++) {
      if (regimeLeft-- <= 0) {
        regime = gauss(rand) * spec.vol * 0.35;
        regimeLeft = 150 + Math.floor(rand() * 900);
      }
      volState = 0.94 * volState + 0.06 * (0.5 + rand() * 1.5);
      const ret = spec.drift + regime + gauss(rand) * spec.vol * volState;
      const open = price;
      const close = Math.max(open * (1 + ret), 1e-9);
      const wick = Math.abs(gauss(rand)) * spec.vol * volState * 0.5;
      const high = Math.max(open, close) * (1 + wick);
      const low = Math.min(open, close) * (1 - Math.min(wick, 0.5));
      const volume = baseVolume * (0.4 + Math.abs(ret) / spec.vol) * (0.6 + rand());
      candles.push({ time: start + i * BAR, open, high, low, close, volume });
      price = close;
    }
    const scale = spec.basePrice / price;
    for (const c of candles) {
      c.open *= scale;
      c.high *= scale;
      c.low *= scale;
      c.close *= scale;
    }
    this.series.set(key, candles);
    return candles;
  }

  private buildMarkets(): TokenMarket[] {
    return SPECS.map((spec, i) => {
      const s = this.base(i);
      const last = s[s.length - 1];
      const at = (barsAgo: number) => s[Math.max(0, s.length - 1 - barsAgo)].close;
      const day = s.slice(-288);
      const pct = (a: number, b: number) => ((a - b) / b) * 100;
      return {
        token: { address: fakeAddress(i), symbol: spec.symbol, name: spec.name, decimals: 18 },
        poolAddress: fakeAddress(i + 100),
        feeTier: 3000,
        quoteSymbol: "USDG",
        priceUsd: last.close,
        oraclePriceUsd: last.close,
        oracleBasisPct: 0,
        oracleUpdatedAt: last.time,
        oracleStale: false,
        liquidityUsd: spec.liquidity,
        volume24hUsd: day.reduce((sum, c) => sum + c.volume, 0),
        priceChange1hPct: pct(last.close, at(12)),
        priceChange24hPct: pct(last.close, at(288)),
        txCount24h: Math.round(day.reduce((sum, c) => sum + c.volume, 0) / 900),
        createdAt: Math.floor(Date.now() / 1000) - spec.ageDays * 86400,
        tradableNow: true,
        hasPriceHistory: true,
      };
    });
  }

  async nativeUsd(): Promise<number> {
    return NATIVE_USD;
  }

  async listTokens(limit = 100): Promise<TokenMarket[]> {
    this.markets ??= this.buildMarkets();
    return this.markets.slice(0, limit);
  }

  async findToken(query: string): Promise<TokenMarket | null> {
    const q = query.trim().toLowerCase();
    const all = await this.listTokens();
    return (
      all.find((t) => t.token.address.toLowerCase() === q) ??
      all.find((t) => t.token.symbol.toLowerCase() === q) ??
      all.find((t) => t.token.name.toLowerCase().includes(q)) ??
      null
    );
  }

  async getCandles(token: TokenMarket, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    const index = SPECS.findIndex((s) => s.symbol === token.token.symbol);
    if (index < 0) throw new Error(`Unknown synthetic token ${token.token.symbol}`);
    const base = this.base(index);
    const seconds = TIMEFRAME_SECONDS[timeframe];
    const candles = seconds === BAR ? base : aggregateCandles(base.map((c) => ({ ...c })), seconds);
    return candles.slice(-limit);
  }
}
