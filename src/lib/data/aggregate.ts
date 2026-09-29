import type { Candle } from "../types";

/** Aggregate ascending candles into buckets of `bucketSeconds`. */
export function aggregateCandles(candles: Candle[], bucketSeconds: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const prev = out[out.length - 1];
    if (prev && prev.time === bucket) {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
    } else {
      out.push({ ...c, time: bucket });
    }
  }
  return out;
}
