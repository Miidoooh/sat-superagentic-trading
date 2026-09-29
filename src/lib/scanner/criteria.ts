import { z } from "zod";

export const PATTERN_IDS = [
  "golden_cross",
  "death_cross",
  "macd_bull_cross",
  "macd_bear_cross",
  "rsi_overbought",
  "rsi_oversold",
  "breakout_up",
  "breakdown",
  "bb_squeeze",
  "double_top",
  "double_bottom",
  "rsi_bull_div",
  "rsi_bear_div",
] as const;

export const ScanCriteriaSchema = z
  .object({
    // Market-level filters (cheap; applied first)
    minLiquidityUsd: z.number().nonnegative().optional(),
    maxLiquidityUsd: z.number().nonnegative().optional(),
    minVolume24hUsd: z.number().nonnegative().optional(),
    minPriceChange1hPct: z.number().optional(),
    maxPriceChange1hPct: z.number().optional(),
    minPriceChange24hPct: z.number().optional(),
    maxPriceChange24hPct: z.number().optional(),
    minAgeDays: z.number().nonnegative().optional(),
    maxAgeDays: z.number().nonnegative().optional(),
    symbolContains: z.string().max(40).optional(),
    /** Only assets Robinhood reports as tradable in the current session */
    tradableNow: z.boolean().optional(),
    /** Max absolute gap between pool price and Chainlink oracle price, in percent */
    maxOracleBasisPct: z.number().positive().optional(),

    // Technical filters (require candles)
    timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).default("4h"),
    rsiMin: z.number().min(0).max(100).optional(),
    rsiMax: z.number().min(0).max(100).optional(),
    trend: z.enum(["bullish", "bearish", "neutral"]).optional(),
    priceAboveSma20: z.boolean().optional(),
    priceAboveSma50: z.boolean().optional(),
    /** Token matches if ANY of these patterns fired recently */
    patternsAny: z.array(z.enum(PATTERN_IDS)).max(PATTERN_IDS.length).optional(),
    patternDirection: z.enum(["bullish", "bearish", "neutral"]).optional(),
    minPatternConfidence: z.number().min(0).max(1).optional(),

    /** Defaults to liquidity: it is the one ranking every data source can produce. */
    sortBy: z
      .enum(["liquidity", "volume24h", "change1h", "change24h", "rsi", "patternConfidence"])
      .default("liquidity"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export type ScanCriteria = z.infer<typeof ScanCriteriaSchema>;
export type ScanCriteriaInput = z.input<typeof ScanCriteriaSchema>;
