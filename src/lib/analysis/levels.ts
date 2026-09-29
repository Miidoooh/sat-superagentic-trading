import type { Candle, Level } from "../types";

export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
}

/** Fractal pivots: a bar whose high/low is the extreme within `span` bars each side. */
export function findPivots(candles: Candle[], span = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true;
    let isLow = true;
    // Left side strict, right side tolerates ties: the next candle usually opens at this
    // candle's close, so exact ties at a turning point are common in real data.
    for (let j = 1; j <= span; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high < candles[i + j].high) {
        isHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low > candles[i + j].low) {
        isLow = false;
      }
    }
    if (isHigh) pivots.push({ index: i, price: candles[i].high, kind: "high" });
    if (isLow) pivots.push({ index: i, price: candles[i].low, kind: "low" });
  }
  return pivots;
}

/**
 * Cluster pivots within `tolerancePct` of each other into support/resistance
 * levels, classified relative to the last close.
 */
export function findLevels(candles: Candle[], tolerancePct = 0.01, maxLevels = 6): Level[] {
  if (candles.length < 10) return [];
  const pivots = findPivots(candles);
  const clusters: { sum: number; count: number }[] = [];
  for (const p of pivots.sort((a, b) => a.price - b.price)) {
    const c = clusters[clusters.length - 1];
    const avg = c ? c.sum / c.count : 0;
    if (c && Math.abs(p.price - avg) / avg <= tolerancePct) {
      c.sum += p.price;
      c.count++;
    } else {
      clusters.push({ sum: p.price, count: 1 });
    }
  }
  const close = candles[candles.length - 1].close;
  return clusters
    .map((c) => ({
      price: c.sum / c.count,
      touches: c.count,
      kind: (c.sum / c.count <= close ? "support" : "resistance") as Level["kind"],
    }))
    .filter((l) => l.touches >= 2)
    .sort((a, b) => b.touches - a.touches || Math.abs(a.price - close) - Math.abs(b.price - close))
    .slice(0, maxLevels)
    .sort((a, b) => b.price - a.price);
}
