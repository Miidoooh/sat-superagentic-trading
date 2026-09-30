import { cache } from "../cache";
import { getPublicClient } from "./client";

/** Measured on mainnet: 100,000 blocks span 10,031 seconds. */
export const SECONDS_PER_BLOCK = 0.1003;

export interface BlockClock {
  head: bigint;
  headTime: number;
}

/** Latest block and its timestamp. Every other block time is interpolated from it. */
export async function blockClock(): Promise<BlockClock> {
  return cache.get("chain:clock", 2_000, async () => {
    const block = await getPublicClient().getBlock({ blockTag: "latest" });
    return { head: block.number, headTime: Number(block.timestamp) };
  });
}

export function blockTime(clock: BlockClock, block: bigint | number): number {
  return Math.round(clock.headTime - Number(clock.head - BigInt(block)) * SECONDS_PER_BLOCK);
}

export function blocksFor(seconds: number): bigint {
  return BigInt(Math.ceil(seconds / SECONDS_PER_BLOCK));
}

/** The node allows only 100,000 blocks when a log query lists several addresses. */
export const POOL_QUERY_SPAN = 90_000n;

const MAX_SPLIT_DEPTH = 8;
const RATE_LIMIT_RETRIES = 4;

export function isRateLimited(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 6; e = (e as { cause?: unknown }).cause, i++) {
    // viem error messages embed the request body, whose hex can contain "429", so match words only.
    const { status, code, shortMessage, details } = e as { status?: number; code?: number; shortMessage?: string; details?: string };
    if (status === 429 || code === 429 || /too many requests|rate limit/i.test(`${shortMessage ?? ""} ${details ?? ""}`)) return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch logs for a block range, halving the range whenever the node rejects
 * it for matching more than its 10,000-log cap. A rate-limited request is
 * retried whole after a backoff, since splitting it would only add requests.
 */
export async function getLogsAdaptive<T>(
  from: bigint,
  to: bigint,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  depth = 0,
): Promise<T[]> {
  if (from > to) return [];
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchRange(from, to);
      } catch (err) {
        if (!isRateLimited(err) || attempt >= RATE_LIMIT_RETRIES) throw err;
        await sleep(400 * 2 ** attempt + Math.random() * 250);
      }
    }
  } catch (err) {
    if (isRateLimited(err) || depth >= MAX_SPLIT_DEPTH || to - from < 2n) throw err;
    const mid = from + (to - from) / 2n;
    const left = await getLogsAdaptive(from, mid, fetchRange, depth + 1);
    const right = await getLogsAdaptive(mid + 1n, to, fetchRange, depth + 1);
    return [...left, ...right];
  }
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Wrap a log reader so wide ranges are cut into fixed spans and read a few at
 * a time. Busy events fill the node's 10,000-log cap within a few thousand
 * blocks, so starting narrow beats discovering the limit by halving.
 */
export function spanned<T>(
  span: bigint,
  concurrency: number,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
): (from: bigint, to: bigint) => Promise<T[]> {
  return async (from, to) => {
    if (to - from < span) return fetchRange(from, to);
    const spans: { from: bigint; to: bigint }[] = [];
    for (let a = from; a <= to; a += span) spans.push({ from: a, to: a + span - 1n > to ? to : a + span - 1n });
    const parts = await mapPool(spans, concurrency, (s) => getLogsAdaptive(s.from, s.to, fetchRange));
    return parts.flat();
  };
}

export interface BlockItem {
  block: bigint;
}

/**
 * A sliding window over recent logs. After the first fill, each refresh only
 * reads blocks that arrived since the previous one, then drops what fell out
 * of the window.
 */
export class RollingWindow<T extends BlockItem> {
  private items: T[] = [];
  private toBlock = -1n;

  /** `floorBlock` pins the window's start, e.g. to a token's launch block. */
  constructor(
    private readonly windowBlocks: bigint,
    private readonly fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
    private readonly floorBlock = 0n,
  ) {}

  async refresh(head: bigint): Promise<T[]> {
    const rolling = head > this.windowBlocks ? head - this.windowBlocks : 0n;
    const start = rolling > this.floorBlock ? rolling : this.floorBlock > 0n ? this.floorBlock - 1n : 0n;
    const from = this.toBlock >= start ? this.toBlock + 1n : start;
    if (from <= head) {
      const fresh = await getLogsAdaptive(from, head, this.fetchRange);
      this.items = this.toBlock >= start ? [...this.items, ...fresh] : fresh;
      this.toBlock = head;
    }
    this.items = this.items.filter((item) => item.block > start);
    return this.items;
  }
}
