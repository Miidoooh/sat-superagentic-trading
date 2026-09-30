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

const MAX_SPLIT_DEPTH = 8;
const RATE_LIMIT_RETRIES = 4;

export function isRateLimited(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 6; e = (e as { cause?: unknown }).cause, i++) {
    const { status, message, details } = e as { status?: number; message?: string; details?: string };
    if (status === 429 || /429|too many requests|rate limit/i.test(`${message ?? ""} ${details ?? ""}`)) return true;
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

  constructor(
    private readonly windowBlocks: bigint,
    private readonly fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  ) {}

  async refresh(head: bigint): Promise<T[]> {
    const start = head > this.windowBlocks ? head - this.windowBlocks : 0n;
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
