import { getAddress } from "viem";
import type { Candle, ProviderCapabilities, Timeframe, TokenInfo, TokenMarket } from "../types";
import { TIMEFRAME_SECONDS } from "../types";
import type { MarketDataProvider } from "./provider";
import { aggregateCandles } from "./aggregate";

/**
 * Reads a Uniswap-v3-style subgraph deployed for Robinhood Chain.
 * Expected entities: pools, poolHourDatas, bundle.
 */

const STABLES = new Set(["USDC", "USDT", "DAI", "USDC.E", "USDS", "PYUSD"]);
const WRAPPED_NATIVE = new Set(["WETH", "WRH", "WETH9"]);

interface GqlToken {
  id: string;
  symbol: string;
  name: string;
  decimals: string;
}

interface GqlPool {
  id: string;
  feeTier: string;
  createdAtTimestamp: string;
  token0: GqlToken;
  token1: GqlToken;
  token0Price: string;
  token1Price: string;
  totalValueLockedUSD: string;
  txCount: string;
  poolDayData: { date: number; volumeUSD: string; close: string }[];
  poolHourData: { periodStartUnix: number; close: string }[];
}

interface Quote {
  kind: "stable" | "native";
}

function classifyQuote(sym: string): Quote | null {
  const s = sym.toUpperCase();
  if (STABLES.has(s)) return { kind: "stable" };
  if (WRAPPED_NATIVE.has(s)) return { kind: "native" };
  return null;
}

const POOL_FIELDS = `
  id feeTier createdAtTimestamp txCount totalValueLockedUSD token0Price token1Price
  token0 { id symbol name decimals }
  token1 { id symbol name decimals }
  poolDayData: poolDayDatas(first: 2, orderBy: date, orderDirection: desc) { date volumeUSD close }
  poolHourData: poolHourDatas(first: 2, orderBy: periodStartUnix, orderDirection: desc) { periodStartUnix close }
`;

export class SubgraphProvider implements MarketDataProvider {
  readonly source = "subgraph" as const;
  /** Subgraph exposes hourly and daily buckets; sub-hour timeframes are unavailable. */
  readonly supportedTimeframes: readonly Timeframe[] = ["1h", "4h", "1d"];
  readonly capabilities: ProviderCapabilities = {
    volume24h: true,
    txCount24h: true,
    tokenAge: true,
    priceHistory: true,
    liveTrading: true,
  };
  private nativeCache?: { value: number; at: number };
  private poolSides = new Map<string, { baseIsToken0: boolean; quote: Quote }>();

  constructor(private readonly url: string) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`Subgraph error: ${json.errors[0].message}`);
    if (!json.data) throw new Error("Subgraph returned no data");
    return json.data;
  }

  async nativeUsd(): Promise<number> {
    if (this.nativeCache && Date.now() - this.nativeCache.at < 60_000) return this.nativeCache.value;
    const data = await this.gql<{ bundles: { ethPriceUSD: string }[] }>(
      `{ bundles(first: 1) { ethPriceUSD } }`,
    );
    const value = Number(data.bundles[0]?.ethPriceUSD ?? 0);
    if (!(value > 0)) throw new Error("Subgraph bundle has no native USD price");
    this.nativeCache = { value, at: Date.now() };
    return value;
  }

  private toMarket(pool: GqlPool, nativeUsd: number): TokenMarket | null {
    const q0 = classifyQuote(pool.token0.symbol);
    const q1 = classifyQuote(pool.token1.symbol);
    // Base token is the non-quote side; skip stable/native pairs (e.g. WETH/USDC).
    let baseIsToken0: boolean;
    let quote: Quote;
    if (q1 && !q0) {
      baseIsToken0 = true;
      quote = q1;
    } else if (q0 && !q1) {
      baseIsToken0 = false;
      quote = q0;
    } else {
      return null;
    }
    const base = baseIsToken0 ? pool.token0 : pool.token1;
    const priceInQuote = Number(baseIsToken0 ? pool.token0Price : pool.token1Price);
    const usdPerQuote = quote.kind === "stable" ? 1 : nativeUsd;
    const priceUsd = priceInQuote * usdPerQuote;
    if (!(priceUsd > 0)) return null;

    const poolAddress = getAddress(pool.id);
    this.poolSides.set(poolAddress, { baseIsToken0, quote });

    const dayNow = pool.poolDayData[0];
    const hourNow = pool.poolHourData[0];
    const hourPrev = pool.poolHourData[1];
    const dayPrev = pool.poolDayData[1];
    const toPrice = (close: string) => {
      const c0 = Number(close);
      // Hour/day `close` is token0Price; invert when base is token1.
      const inQuote = baseIsToken0 ? c0 : c0 > 0 ? 1 / c0 : 0;
      return inQuote * usdPerQuote;
    };
    const pct = (now: number, prev: number) => (prev > 0 ? ((now - prev) / prev) * 100 : 0);

    return {
      token: {
        address: getAddress(base.id),
        symbol: base.symbol,
        name: base.name,
        decimals: Number(base.decimals),
      },
      poolAddress,
      feeTier: Number(pool.feeTier),
      quoteSymbol: baseIsToken0 ? pool.token1.symbol : pool.token0.symbol,
      priceUsd,
      oraclePriceUsd: null,
      oracleBasisPct: null,
      oracleUpdatedAt: null,
      oracleStale: false,
      liquidityUsd: Number(pool.totalValueLockedUSD),
      volume24hUsd: Number(dayNow?.volumeUSD ?? 0),
      priceChange1hPct: hourPrev ? pct(priceUsd, toPrice(hourPrev.close)) : 0,
      priceChange24hPct: dayPrev ? pct(priceUsd, toPrice(dayPrev.close)) : 0,
      txCount24h: Number(pool.txCount),
      createdAt: Number(pool.createdAtTimestamp),
      tradableNow: null,
      hasPriceHistory: true,
      venue: "uniswap-v3",
    };
  }

  async listTokens(limit = 100): Promise<TokenMarket[]> {
    const [nativeUsd, data] = await Promise.all([
      this.nativeUsd(),
      this.gql<{ pools: GqlPool[] }>(
        `query($n: Int!) { pools(first: $n, orderBy: totalValueLockedUSD, orderDirection: desc) { ${POOL_FIELDS} } }`,
        { n: Math.min(limit * 2, 500) },
      ),
    ]);
    const seen = new Set<string>();
    const out: TokenMarket[] = [];
    for (const pool of data.pools) {
      const m = this.toMarket(pool, nativeUsd);
      if (!m || seen.has(m.token.address)) continue;
      seen.add(m.token.address);
      out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  }

  async findToken(query: string): Promise<TokenMarket | null> {
    const q = query.trim().toLowerCase();
    const all = await this.listTokens(200);
    return (
      all.find((t) => t.token.address.toLowerCase() === q) ??
      all.find((t) => t.token.symbol.toLowerCase() === q) ??
      all.find((t) => t.token.name.toLowerCase().includes(q)) ??
      null
    );
  }

  async getCandles(token: TokenMarket, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    if (!this.supportedTimeframes.includes(timeframe)) {
      throw new Error(`Timeframe ${timeframe} not supported by subgraph; use ${this.supportedTimeframes.join(", ")}`);
    }
    let side = this.poolSides.get(token.poolAddress);
    if (!side) {
      await this.listTokens(200);
      side = this.poolSides.get(token.poolAddress);
    }
    if (!side) throw new Error(`Unknown pool ${token.poolAddress}`);

    const bucket = TIMEFRAME_SECONDS[timeframe];
    const hoursNeeded = Math.min(1000, Math.ceil((limit * bucket) / 3600) + 2);
    const nativeUsd = await this.nativeUsd();
    const usdPerQuote = side.quote.kind === "stable" ? 1 : nativeUsd;

    const data = await this.gql<{
      poolHourDatas: { periodStartUnix: number; open: string; high: string; low: string; close: string; volumeUSD: string }[];
    }>(
      `query($pool: String!, $n: Int!) {
        poolHourDatas(first: $n, where: { pool: $pool }, orderBy: periodStartUnix, orderDirection: desc) {
          periodStartUnix open high low close volumeUSD
        }
      }`,
      { pool: token.poolAddress.toLowerCase(), n: hoursNeeded },
    );

    const hourly: Candle[] = data.poolHourDatas
      .slice()
      .reverse()
      .map((h) => {
        const o = Number(h.open);
        const hi = Number(h.high);
        const lo = Number(h.low);
        const c = Number(h.close);
        // Values are token0Price; invert (and swap high/low) if base is token1.
        const conv = (v: number) => (side!.baseIsToken0 ? v : v > 0 ? 1 / v : 0) * usdPerQuote;
        const highs = side!.baseIsToken0 ? [conv(hi), conv(lo)] : [conv(lo), conv(hi)];
        return {
          time: h.periodStartUnix,
          open: conv(o),
          high: Math.max(highs[0], highs[1]),
          low: Math.min(highs[0], highs[1]),
          close: conv(c),
          volume: Number(h.volumeUSD),
        };
      })
      .filter((c) => c.open > 0 && c.close > 0);

    const candles = timeframe === "1h" ? hourly : aggregateCandles(hourly, bucket);
    return candles.slice(-limit);
  }
}

export type { TokenInfo };
