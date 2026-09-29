import type { Candle, ChartAnalysis, Direction, Timeframe } from "../types";
import { atr, bollinger, ema, last, macd, rsi, sma } from "./indicators";
import { findLevels } from "./levels";
import { detectPatterns } from "./patterns";

function fmt(n: number | null, digits = 2): string {
  return n === null ? "n/a" : n.toFixed(digits);
}

function classifyTrend(
  close: number,
  sma20: number | null,
  sma50: number | null,
  macdHist: number | null,
): ChartAnalysis["trend"] {
  let score = 0;
  const reasons: string[] = [];
  if (sma20 !== null) {
    score += close > sma20 ? 1 : -1;
    reasons.push(`price ${close > sma20 ? "above" : "below"} SMA20`);
  }
  if (sma20 !== null && sma50 !== null) {
    score += sma20 > sma50 ? 1 : -1;
    reasons.push(`SMA20 ${sma20 > sma50 ? "above" : "below"} SMA50`);
  }
  // Ignore a histogram that is effectively zero (e.g. a perfectly steady trend)
  if (macdHist !== null && Math.abs(macdHist) / close > 1e-6) {
    score += macdHist > 0 ? 1 : -1;
    reasons.push(`MACD histogram ${macdHist > 0 ? "positive" : "negative"}`);
  }
  const max = reasons.length || 1;
  const strength = Math.abs(score) / max;
  const direction: Direction = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
  return { direction, strength: Number(strength.toFixed(2)), reason: reasons.join("; ") || "insufficient data" };
}

export function analyzeChart(candles: Candle[], timeframe: Timeframe): ChartAnalysis {
  if (candles.length === 0) throw new Error("No candles to analyze");
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const sma20 = last(sma(closes, 20));
  const sma50 = last(sma(closes, 50));
  const m = macd(closes);
  const macdLast = last(m.macd);
  const signalLast = last(m.signal);
  const histLast = last(m.histogram);
  const bb = bollinger(closes);
  const bbLast = {
    upper: last(bb.upper),
    middle: last(bb.middle),
    lower: last(bb.lower),
    bandwidth: last(bb.bandwidth),
  };
  const rsi14 = last(rsi(closes));
  const lastPrice = closes[closes.length - 1];

  const trend = classifyTrend(lastPrice, sma20, sma50, histLast);
  const patterns = detectPatterns(candles);
  const levels = findLevels(candles);

  const analysis: ChartAnalysis = {
    timeframe,
    candles: candles.length,
    lastPrice,
    trend,
    indicators: {
      rsi14,
      macd:
        macdLast !== null && signalLast !== null && histLast !== null
          ? { macd: macdLast, signal: signalLast, histogram: histLast }
          : null,
      sma20,
      sma50,
      ema12: last(ema(closes, 12)),
      ema26: last(ema(closes, 26)),
      bollinger:
        bbLast.upper !== null && bbLast.middle !== null && bbLast.lower !== null && bbLast.bandwidth !== null
          ? { upper: bbLast.upper, middle: bbLast.middle, lower: bbLast.lower, bandwidth: bbLast.bandwidth }
          : null,
      atr14: last(atr(highs, lows, closes)),
    },
    levels,
    patterns,
    summary: "",
  };

  const nearestSupport = levels.filter((l) => l.kind === "support").sort((a, b) => b.price - a.price)[0];
  const nearestResistance = levels.filter((l) => l.kind === "resistance").sort((a, b) => a.price - b.price)[0];
  analysis.summary = [
    `${timeframe}: ${trend.direction} (strength ${trend.strength}) - ${trend.reason}.`,
    `RSI ${fmt(rsi14, 1)}.`,
    nearestSupport ? `Nearest support ${nearestSupport.price.toPrecision(5)}.` : "",
    nearestResistance ? `Nearest resistance ${nearestResistance.price.toPrecision(5)}.` : "",
    patterns.length
      ? `Signals: ${patterns.slice(0, 3).map((p) => p.name).join(", ")}.`
      : "No recent pattern signals.",
  ]
    .filter(Boolean)
    .join(" ");
  return analysis;
}
