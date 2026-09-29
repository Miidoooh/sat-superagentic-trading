import type { Candle, PatternSignal } from "../types";
import { bollinger, macd, rsi, sma } from "./indicators";
import { findPivots } from "./levels";

export interface PatternOptions {
  /** Only report signals confirmed within this many most-recent bars */
  recency?: number;
}

const DEFAULT_RECENCY = 5;

function sig(
  candles: Candle[],
  id: string,
  name: string,
  direction: PatternSignal["direction"],
  confidence: number,
  atIndex: number,
  description: string,
): PatternSignal {
  return {
    id,
    name,
    direction,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    atIndex,
    time: candles[atIndex].time,
    description,
  };
}

/** Golden / death cross of SMA20 over SMA50 */
export function detectMaCross(candles: Candle[], recency: number): PatternSignal[] {
  const closes = candles.map((c) => c.close);
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  const out: PatternSignal[] = [];
  for (let i = Math.max(1, candles.length - recency); i < candles.length; i++) {
    if ([fast[i], slow[i], fast[i - 1], slow[i - 1]].some(Number.isNaN)) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      out.push(sig(candles, "golden_cross", "Golden cross (SMA20/50)", "bullish", 0.6, i,
        "SMA20 crossed above SMA50."));
    } else if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
      out.push(sig(candles, "death_cross", "Death cross (SMA20/50)", "bearish", 0.6, i,
        "SMA20 crossed below SMA50."));
    }
  }
  return out;
}

export function detectMacdCross(candles: Candle[], recency: number): PatternSignal[] {
  const { macd: line, signal } = macd(candles.map((c) => c.close));
  const out: PatternSignal[] = [];
  for (let i = Math.max(1, candles.length - recency); i < candles.length; i++) {
    if ([line[i], signal[i], line[i - 1], signal[i - 1]].some(Number.isNaN)) continue;
    if (line[i - 1] <= signal[i - 1] && line[i] > signal[i]) {
      out.push(sig(candles, "macd_bull_cross", "MACD bullish cross", "bullish",
        line[i] < 0 ? 0.65 : 0.5, i, "MACD crossed above its signal line."));
    } else if (line[i - 1] >= signal[i - 1] && line[i] < signal[i]) {
      out.push(sig(candles, "macd_bear_cross", "MACD bearish cross", "bearish",
        line[i] > 0 ? 0.65 : 0.5, i, "MACD crossed below its signal line."));
    }
  }
  return out;
}

export function detectRsiExtreme(candles: Candle[]): PatternSignal[] {
  const series = rsi(candles.map((c) => c.close));
  const i = candles.length - 1;
  const v = series[i];
  if (Number.isNaN(v)) return [];
  if (v >= 70) {
    return [sig(candles, "rsi_overbought", "RSI overbought", "bearish", Math.min(1, 0.4 + (v - 70) / 50), i,
      `RSI(14) is ${v.toFixed(1)}, above 70.`)];
  }
  if (v <= 30) {
    return [sig(candles, "rsi_oversold", "RSI oversold", "bullish", Math.min(1, 0.4 + (30 - v) / 50), i,
      `RSI(14) is ${v.toFixed(1)}, below 30.`)];
  }
  return [];
}

/** Range breakout/breakdown over a lookback window, volume-confirmed when possible. */
export function detectBreakout(candles: Candle[], recency: number, lookback = 20): PatternSignal[] {
  const out: PatternSignal[] = [];
  for (let i = Math.max(lookback, candles.length - recency); i < candles.length; i++) {
    const window = candles.slice(i - lookback, i);
    const hi = Math.max(...window.map((c) => c.high));
    const lo = Math.min(...window.map((c) => c.low));
    const avgVol = window.reduce((s, c) => s + c.volume, 0) / lookback;
    const volRatio = avgVol > 0 ? candles[i].volume / avgVol : 1;
    const confirmed = volRatio >= 1.5;
    const conf = 0.45 + (confirmed ? 0.25 : 0) + Math.min(0.2, (volRatio - 1) * 0.05);
    if (candles[i].close > hi) {
      out.push(sig(candles, "breakout_up", "Range breakout", "bullish", conf, i,
        `Closed above the ${lookback}-bar high (${hi.toPrecision(5)}); volume ${volRatio.toFixed(1)}x average.`));
    } else if (candles[i].close < lo) {
      out.push(sig(candles, "breakdown", "Range breakdown", "bearish", conf, i,
        `Closed below the ${lookback}-bar low (${lo.toPrecision(5)}); volume ${volRatio.toFixed(1)}x average.`));
    }
  }
  return out;
}

/** Bollinger band-width squeeze (bandwidth in bottom decile of recent history). */
export function detectSqueeze(candles: Candle[]): PatternSignal[] {
  const bb = bollinger(candles.map((c) => c.close));
  const bw = bb.bandwidth.filter((v) => !Number.isNaN(v));
  if (bw.length < 40) return [];
  const recent = bw.slice(-100);
  const current = recent[recent.length - 1];
  const sorted = [...recent].sort((a, b) => a - b);
  const rank = sorted.indexOf(current) / (sorted.length - 1);
  if (rank > 0.1) return [];
  return [sig(candles, "bb_squeeze", "Bollinger squeeze", "neutral", 0.5 + (0.1 - rank), candles.length - 1,
    "Band width is in the lowest decile of recent history; a volatility expansion is likely.")];
}

/** Double top / double bottom confirmed by a close beyond the neckline. */
export function detectDoubles(candles: Candle[], recency: number): PatternSignal[] {
  const pivots = findPivots(candles, 3);
  const out: PatternSignal[] = [];
  const lastIdx = candles.length - 1;
  const tol = 0.015;
  const depth = 0.03;

  const highs = pivots.filter((p) => p.kind === "high").slice(-3);
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    const neck = Math.min(...candles.slice(a.index, b.index + 1).map((c) => c.low));
    const similar = Math.abs(a.price - b.price) / a.price <= tol;
    const deep = (Math.min(a.price, b.price) - neck) / neck >= depth;
    if (similar && deep && b.index - a.index >= 5) {
      const confirmIdx = candles.findIndex((c, i) => i > b.index && c.close < neck);
      if (confirmIdx >= 0 && confirmIdx > lastIdx - recency) {
        out.push(sig(candles, "double_top", "Double top", "bearish", 0.7, confirmIdx,
          `Two peaks near ${a.price.toPrecision(5)} with neckline ${neck.toPrecision(5)} broken.`));
      }
    }
  }

  const lows = pivots.filter((p) => p.kind === "low").slice(-3);
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    const neck = Math.max(...candles.slice(a.index, b.index + 1).map((c) => c.high));
    const similar = Math.abs(a.price - b.price) / a.price <= tol;
    const deep = (neck - Math.max(a.price, b.price)) / neck >= depth;
    if (similar && deep && b.index - a.index >= 5) {
      const confirmIdx = candles.findIndex((c, i) => i > b.index && c.close > neck);
      if (confirmIdx >= 0 && confirmIdx > lastIdx - recency) {
        out.push(sig(candles, "double_bottom", "Double bottom", "bullish", 0.7, confirmIdx,
          `Two troughs near ${a.price.toPrecision(5)} with neckline ${neck.toPrecision(5)} broken.`));
      }
    }
  }
  return out;
}

/** Regular RSI divergence between the last two swing points. */
export function detectRsiDivergence(candles: Candle[], recency: number): PatternSignal[] {
  const r = rsi(candles.map((c) => c.close));
  const pivots = findPivots(candles, 3);
  const out: PatternSignal[] = [];
  const lastIdx = candles.length - 1;

  const lows = pivots.filter((p) => p.kind === "low" && !Number.isNaN(r[p.index])).slice(-2);
  if (lows.length === 2 && lows[1].index > lastIdx - recency - 3) {
    const [a, b] = lows;
    if (b.price < a.price && r[b.index] > r[a.index] + 2 && r[a.index] < 45) {
      out.push(sig(candles, "rsi_bull_div", "Bullish RSI divergence", "bullish", 0.65, b.index,
        "Price made a lower low while RSI made a higher low."));
    }
  }
  const highs = pivots.filter((p) => p.kind === "high" && !Number.isNaN(r[p.index])).slice(-2);
  if (highs.length === 2 && highs[1].index > lastIdx - recency - 3) {
    const [a, b] = highs;
    if (b.price > a.price && r[b.index] < r[a.index] - 2 && r[a.index] > 55) {
      out.push(sig(candles, "rsi_bear_div", "Bearish RSI divergence", "bearish", 0.65, b.index,
        "Price made a higher high while RSI made a lower high."));
    }
  }
  return out;
}

export function detectPatterns(candles: Candle[], opts: PatternOptions = {}): PatternSignal[] {
  if (candles.length < 30) return [];
  const recency = opts.recency ?? DEFAULT_RECENCY;
  const all = [
    ...detectMaCross(candles, recency),
    ...detectMacdCross(candles, recency),
    ...detectRsiExtreme(candles),
    ...detectBreakout(candles, recency),
    ...detectSqueeze(candles),
    ...detectDoubles(candles, recency),
    ...detectRsiDivergence(candles, recency),
  ];
  // A signal can fire on several bars inside the recency window; report the
  // strongest occurrence of each rather than the same name repeatedly.
  const best = new Map<string, PatternSignal>();
  for (const signal of all) {
    const existing = best.get(signal.id);
    const better =
      !existing ||
      signal.confidence > existing.confidence ||
      (signal.confidence === existing.confidence && signal.atIndex > existing.atIndex);
    if (better) best.set(signal.id, signal);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}
