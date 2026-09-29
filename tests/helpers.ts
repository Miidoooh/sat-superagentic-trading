import type { Candle } from "../src/lib/types";

/** Build candles from a close series with tight synthetic wicks. */
export function fromCloses(closes: number[], opts: { volume?: number | ((i: number) => number); step?: number } = {}): Candle[] {
  const step = opts.step ?? 3600;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const vol = typeof opts.volume === "function" ? opts.volume(i) : (opts.volume ?? 1000);
    return {
      time: 1_700_000_000 + i * step,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: vol,
    };
  });
}

export function linear(from: number, to: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}
