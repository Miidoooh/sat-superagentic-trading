export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export interface Candle {
  /** Unix seconds, start of the candle */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in USD. Zero when the data source cannot report volume. */
  volume: number;
}

export interface TokenInfo {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  /** ERC-8056 corporate-action multiplier, as reported by Robinhood's asset API */
  multiplier?: number;
  isin?: string;
}

/** Market-level snapshot of a token, derived from its deepest liquidity pool. */
export interface TokenMarket {
  token: TokenInfo;
  poolAddress: `0x${string}`;
  /** Uniswap-v3-style fee tier in hundredths of a bip (e.g. 3000 = 0.3%) */
  feeTier: number;
  quoteSymbol: string;
  /** Tradeable spot price from the pool, in USD */
  priceUsd: number;
  /** Chainlink reference price, when a feed exists for this ticker */
  oraclePriceUsd: number | null;
  /** Percent gap between the pool price and the oracle price */
  oracleBasisPct: number | null;
  oracleUpdatedAt: number | null;
  oracleStale: boolean;
  liquidityUsd: number;
  /** Null when the data source cannot report volume */
  volume24hUsd: number | null;
  priceChange1hPct: number | null;
  priceChange24hPct: number | null;
  txCount24h: number | null;
  /** Unix seconds when the pool was created, or null if unknown */
  createdAt: number | null;
  /** True when Robinhood reports the asset as tradable in the current session */
  tradableNow: boolean | null;
  hasPriceHistory: boolean;
  /** Where the spot price was read. Pons launches trade on a bonding curve until they graduate. */
  venue: "uniswap-v3" | "pons";
  /** Bonding-curve state, Pons launches only. Raised excludes the curve's virtual reserve. */
  curve?: { progressPct: number; raisedUsd: number; thresholdUsd: number };
}

export type Direction = "bullish" | "bearish" | "neutral";

export interface PatternSignal {
  id: string;
  name: string;
  direction: Direction;
  /** 0..1 heuristic confidence */
  confidence: number;
  /** Index into the candle array where the pattern was confirmed */
  atIndex: number;
  time: number;
  description: string;
}

export interface Level {
  price: number;
  kind: "support" | "resistance";
  /** Number of pivot touches that formed this level */
  touches: number;
}

export interface ChartAnalysis {
  timeframe: Timeframe;
  candles: number;
  lastPrice: number;
  trend: {
    direction: Direction;
    strength: number;
    reason: string;
  };
  indicators: {
    rsi14: number | null;
    macd: { macd: number; signal: number; histogram: number } | null;
    sma20: number | null;
    sma50: number | null;
    ema12: number | null;
    ema26: number | null;
    bollinger: { upper: number; middle: number; lower: number; bandwidth: number } | null;
    atr14: number | null;
  };
  levels: Level[];
  patterns: PatternSignal[];
  summary: string;
}

export type DataSource = "robinhood-chain" | "subgraph" | "synthetic";

/**
 * Which fields a data source can actually populate. The scanner refuses
 * filters on unsupported fields rather than silently returning wrong results.
 */
export interface ProviderCapabilities {
  volume24h: boolean;
  txCount24h: boolean;
  tokenAge: boolean;
  priceHistory: boolean;
  /** Real prices that correspond to something tradeable */
  liveTrading: boolean;
}
