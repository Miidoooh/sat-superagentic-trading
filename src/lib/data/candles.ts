import type { Candle } from "../types";
import type { PricePoint } from "./chainlink";

/** Empty buckets we are willing to carry a flat candle across. */
const MAX_FILL = 3;

/**
 * Turn irregular oracle price points into fixed-width candles.
 *
 * Chainlink publishes on price deviation, so a bucket may hold several points
 * or none. Buckets with points get a true open/high/low/close. Short runs of
 * empty buckets are carried forward as flat candles so indicators see a
 * contiguous series; longer gaps (weekends, halted feeds) are left out rather
 * than invented. Oracle points carry no trade size, so their volume is zero;
 * trade points pass `volume` in USD and it is summed per bucket.
 *
 * `maxFill` sets how many empty buckets may be carried flat. A bonding curve's
 * price only moves on a trade, so curve candles fill every gap.
 */
export function candlesFromPricePoints(
  points: (PricePoint & { volume?: number })[],
  bucketSeconds: number,
  maxFill = MAX_FILL,
): Candle[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.time - b.time);

  const buckets = new Map<number, number[]>();
  const volumes = new Map<number, number>();
  for (const p of sorted) {
    if (!(p.price > 0)) continue;
    const bucket = Math.floor(p.time / bucketSeconds) * bucketSeconds;
    const list = buckets.get(bucket);
    if (list) list.push(p.price);
    else buckets.set(bucket, [p.price]);
    if (p.volume) volumes.set(bucket, (volumes.get(bucket) ?? 0) + p.volume);
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const candles: Candle[] = [];
  let previousClose: number | null = null;

  for (let i = 0; i < keys.length; i++) {
    const bucket = keys[i];
    if (previousClose !== null && i > 0) {
      const missing = (bucket - keys[i - 1]) / bucketSeconds - 1;
      if (missing > 0 && missing <= maxFill) {
        for (let m = 1; m <= missing; m++) {
          const time = keys[i - 1] + m * bucketSeconds;
          candles.push({ time, open: previousClose, high: previousClose, low: previousClose, close: previousClose, volume: 0 });
        }
      }
    }
    const prices = buckets.get(bucket)!;
    // The previous close is this candle's open: it was the live price entering the bucket.
    const open = previousClose ?? prices[0];
    const close = prices[prices.length - 1];
    candles.push({
      time: bucket,
      open,
      high: Math.max(open, ...prices),
      low: Math.min(open, ...prices),
      close,
      volume: volumes.get(bucket) ?? 0,
    });
    previousClose = close;
  }

  return candles;
}
