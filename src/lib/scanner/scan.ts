import type { ChartAnalysis, DataSource, TokenMarket } from "../types";
import { analyzeChart } from "../analysis/analyze";
import type { MarketDataProvider } from "../data/provider";
import { ScanCriteriaSchema, type ScanCriteria, type ScanCriteriaInput } from "./criteria";

export interface ScanMatch {
  market: TokenMarket;
  analysis: ChartAnalysis | null;
  reasons: string[];
  topPatternConfidence: number;
}

export interface ScanResult {
  source: DataSource;
  criteria: ScanCriteria;
  scanned: number;
  passedMarketFilters: number;
  matches: ScanMatch[];
  notes: string[];
}

/** Max tokens we pull candles for in a single scan */
const MAX_TECHNICAL_SCANS = 24;

export function passesMarketFilters(m: TokenMarket, c: ScanCriteria, nowSec: number): string[] | null {
  const reasons: string[] = [];

  /** A range check that fails closed when the value is unavailable. */
  const range = (
    value: number | null,
    min: number | undefined,
    max: number | undefined,
    label: (n: number) => string,
  ): boolean => {
    if (min === undefined && max === undefined) return true;
    if (value === null) return false;
    if (min !== undefined) {
      if (value < min) return false;
      reasons.push(label(min));
    }
    if (max !== undefined) {
      if (value > max) return false;
      reasons.push(label(max));
    }
    return true;
  };

  if (!range(m.liquidityUsd, c.minLiquidityUsd, c.maxLiquidityUsd, (n) => `liquidity vs $${n.toLocaleString()}`)) return null;
  if (!range(m.volume24hUsd, c.minVolume24hUsd, undefined, (n) => `24h volume >= $${n.toLocaleString()}`)) return null;
  if (!range(m.priceChange1hPct, c.minPriceChange1hPct, c.maxPriceChange1hPct, (n) => `1h change vs ${n}%`)) return null;
  if (!range(m.priceChange24hPct, c.minPriceChange24hPct, c.maxPriceChange24hPct, (n) => `24h change vs ${n}%`)) return null;

  const ageDays = m.createdAt === null ? null : (nowSec - m.createdAt) / 86400;
  if (!range(ageDays, c.minAgeDays, c.maxAgeDays, (n) => `age vs ${n}d`)) return null;

  if (c.symbolContains !== undefined) {
    const needle = c.symbolContains.toLowerCase();
    const hit =
      m.token.symbol.toLowerCase().includes(needle) || m.token.name.toLowerCase().includes(needle);
    if (!hit) return null;
    reasons.push(`matches "${c.symbolContains}"`);
  }
  if (c.tradableNow === true) {
    if (m.tradableNow !== true) return null;
    reasons.push("tradable now");
  }
  if (c.maxOracleBasisPct !== undefined) {
    if (m.oracleBasisPct === null || Math.abs(m.oracleBasisPct) > c.maxOracleBasisPct) return null;
    reasons.push(`within ${c.maxOracleBasisPct}% of oracle`);
  }
  return reasons;
}

function technicalKeys(c: ScanCriteria): boolean {
  return (
    c.rsiMin !== undefined ||
    c.rsiMax !== undefined ||
    c.trend !== undefined ||
    c.priceAboveSma20 !== undefined ||
    c.priceAboveSma50 !== undefined ||
    (c.patternsAny?.length ?? 0) > 0 ||
    c.patternDirection !== undefined ||
    c.sortBy === "rsi" ||
    c.sortBy === "patternConfidence"
  );
}

/** Reject criteria the data source cannot answer, instead of returning wrong results. */
export function unsupportedCriteria(provider: MarketDataProvider, c: ScanCriteria): string[] {
  const caps = provider.capabilities;
  const problems: string[] = [];
  if (!caps.volume24h && (c.minVolume24hUsd !== undefined || c.sortBy === "volume24h")) {
    problems.push(`24h volume is not available from the ${provider.source} data source`);
  }
  if (!caps.tokenAge && (c.minAgeDays !== undefined || c.maxAgeDays !== undefined)) {
    problems.push(`token age is not available from the ${provider.source} data source`);
  }
  if (!caps.priceHistory && technicalKeys(c)) {
    problems.push(`price history is not available from the ${provider.source} data source`);
  }
  if (technicalKeys(c) && !provider.supportedTimeframes.includes(c.timeframe)) {
    problems.push(
      `timeframe ${c.timeframe} is not available from the ${provider.source} data source (supported: ${provider.supportedTimeframes.join(", ")})`,
    );
  }
  return problems;
}

export function passesTechnicalFilters(
  a: ChartAnalysis,
  c: ScanCriteria,
): { ok: boolean; reasons: string[]; conf: number } {
  const reasons: string[] = [];
  const rsi = a.indicators.rsi14;
  if (c.rsiMin !== undefined) {
    if (rsi === null || rsi < c.rsiMin) return { ok: false, reasons, conf: 0 };
    reasons.push(`RSI ${rsi.toFixed(1)} >= ${c.rsiMin}`);
  }
  if (c.rsiMax !== undefined) {
    if (rsi === null || rsi > c.rsiMax) return { ok: false, reasons, conf: 0 };
    reasons.push(`RSI ${rsi.toFixed(1)} <= ${c.rsiMax}`);
  }
  if (c.trend !== undefined) {
    if (a.trend.direction !== c.trend) return { ok: false, reasons, conf: 0 };
    reasons.push(`${c.trend} trend`);
  }
  if (c.priceAboveSma20 !== undefined) {
    if (a.indicators.sma20 === null || a.lastPrice > a.indicators.sma20 !== c.priceAboveSma20) {
      return { ok: false, reasons, conf: 0 };
    }
    reasons.push(`price ${c.priceAboveSma20 ? "above" : "below"} SMA20`);
  }
  if (c.priceAboveSma50 !== undefined) {
    if (a.indicators.sma50 === null || a.lastPrice > a.indicators.sma50 !== c.priceAboveSma50) {
      return { ok: false, reasons, conf: 0 };
    }
    reasons.push(`price ${c.priceAboveSma50 ? "above" : "below"} SMA50`);
  }

  let conf = 0;
  const wantsPattern = (c.patternsAny?.length ?? 0) > 0 || c.patternDirection !== undefined;
  if (wantsPattern) {
    const hits = a.patterns.filter(
      (p) =>
        (!c.patternsAny?.length || c.patternsAny.includes(p.id as never)) &&
        (c.patternDirection === undefined || p.direction === c.patternDirection) &&
        p.confidence >= (c.minPatternConfidence ?? 0),
    );
    if (hits.length === 0) return { ok: false, reasons, conf: 0 };
    conf = Math.max(...hits.map((h) => h.confidence));
    reasons.push(...hits.map((h) => `${h.name} (${h.confidence})`));
  } else {
    conf = a.patterns[0]?.confidence ?? 0;
  }
  return { ok: true, reasons, conf };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function sortValue(m: ScanMatch, key: ScanCriteria["sortBy"]): number {
  switch (key) {
    case "liquidity":
      return m.market.liquidityUsd;
    case "volume24h":
      return m.market.volume24hUsd ?? -1;
    case "change1h":
      return m.market.priceChange1hPct ?? -Infinity;
    case "change24h":
      return m.market.priceChange24hPct ?? -Infinity;
    case "rsi":
      return m.analysis?.indicators.rsi14 ?? -1;
    case "patternConfidence":
      return m.topPatternConfidence;
  }
}

export async function scanTokens(
  provider: MarketDataProvider,
  input: ScanCriteriaInput,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<ScanResult> {
  const criteria = ScanCriteriaSchema.parse(input);
  const blockers = unsupportedCriteria(provider, criteria);
  if (blockers.length > 0) throw new Error(blockers.join("; "));

  const notes: string[] = [];
  const universe = await provider.listTokens(500);

  const survivors: { market: TokenMarket; reasons: string[] }[] = [];
  for (const market of universe) {
    const reasons = passesMarketFilters(market, criteria, nowSec);
    if (reasons) survivors.push({ market, reasons });
  }

  let matches: ScanMatch[];
  if (!technicalKeys(criteria)) {
    matches = survivors.map((s) => ({
      market: s.market,
      analysis: null,
      reasons: s.reasons,
      topPatternConfidence: 0,
    }));
  } else {
    let pool = survivors.filter((s) => s.market.hasPriceHistory);
    const skipped = survivors.length - pool.length;
    if (skipped > 0) notes.push(`${skipped} tokens skipped: no price history available for them.`);
    if (pool.length > MAX_TECHNICAL_SCANS) {
      pool = [...pool].sort((a, b) => b.market.liquidityUsd - a.market.liquidityUsd).slice(0, MAX_TECHNICAL_SCANS);
      notes.push(`Technical scan limited to the ${MAX_TECHNICAL_SCANS} deepest-liquidity tokens that passed.`);
    }
    const analyzed = await mapLimit(pool, 4, async (s): Promise<ScanMatch | null> => {
      try {
        const candles = await provider.getCandles(s.market, criteria.timeframe, 300);
        if (candles.length < 30) return null;
        const analysis = analyzeChart(candles, criteria.timeframe);
        const t = passesTechnicalFilters(analysis, criteria);
        if (!t.ok) return null;
        return { market: s.market, analysis, reasons: [...s.reasons, ...t.reasons], topPatternConfidence: t.conf };
      } catch (err) {
        notes.push(`Skipped ${s.market.token.symbol}: ${(err as Error).message}`);
        return null;
      }
    });
    matches = analyzed.filter((m): m is ScanMatch => m !== null);
  }

  const dir = criteria.sortDir === "asc" ? 1 : -1;
  matches.sort((a, b) => dir * (sortValue(a, criteria.sortBy) - sortValue(b, criteria.sortBy)));

  return {
    source: provider.source,
    criteria,
    scanned: universe.length,
    passedMarketFilters: survivors.length,
    matches: matches.slice(0, criteria.limit),
    notes,
  };
}
