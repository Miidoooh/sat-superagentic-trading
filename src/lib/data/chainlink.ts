import { getAddress, parseAbi } from "viem";
import { CHAINLINK_DIRECTORY } from "../chain/constants";
import { getPublicClient } from "../chain/client";
import { cache } from "../cache";

/**
 * Chainlink price feeds are the only source of price *history* on Robinhood
 * Chain: at ~100ms block times, scanning Swap logs over days is not feasible on
 * a public RPC, but each feed's historical rounds are a few contract reads.
 *
 * Feed addresses are resolved from Chainlink's own directory rather than
 * hardcoded, as Robinhood's docs instruct.
 */

export const aggregatorV3Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export interface FeedInfo {
  /** Ticker the feed prices, e.g. "TSLA" or "ETH" */
  symbol: string;
  name: string;
  proxyAddress: `0x${string}`;
  decimals: number;
  /** Seconds after which a price is considered stale by Chainlink's own spec */
  heartbeat: number;
  /** True for "Robinhood <TICKER> / USD" equity and ETF feeds */
  isEquity: boolean;
}

interface DirectoryEntry {
  name?: string;
  proxyAddress?: string;
  decimals?: number;
  heartbeat?: number;
}

/**
 * Directory names are inconsistent ("Robinhood TSLA / USD", "Robinhood
 * SGOV-USD", "ETH / USD"), so normalise to a bare ticker.
 */
function parseFeedName(name: string): { symbol: string; isEquity: boolean } | null {
  const isEquity = /^Robinhood\s+/i.test(name);
  const body = name.replace(/^Robinhood\s+/i, "").trim();
  // Skip exchange-rate feeds such as "WEETH / EETH Exchange Rate".
  if (/exchange rate/i.test(body)) return null;
  const [base, quote] = body.split(/\s*[/-]\s*/);
  if (!base || !quote) return null;
  if (quote.toUpperCase() !== "USD") return null;
  const symbol = base.trim().toUpperCase();
  return /^[A-Z0-9.]{1,12}$/.test(symbol) ? { symbol, isEquity } : null;
}

const DIRECTORY_TTL = 6 * 60 * 60 * 1000;

export async function getFeeds(): Promise<Map<string, FeedInfo>> {
  return cache.get("chainlink:directory", DIRECTORY_TTL, async () => {
    const res = await fetch(CHAINLINK_DIRECTORY, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Chainlink directory HTTP ${res.status}`);
    const raw = (await res.json()) as DirectoryEntry[];
    const feeds = new Map<string, FeedInfo>();
    for (const entry of raw) {
      if (!entry.name || !entry.proxyAddress) continue;
      const parsed = parseFeedName(entry.name);
      if (!parsed) continue;
      const info: FeedInfo = {
        symbol: parsed.symbol,
        name: entry.name,
        proxyAddress: getAddress(entry.proxyAddress),
        decimals: entry.decimals ?? 8,
        heartbeat: entry.heartbeat ?? 86_400,
        isEquity: parsed.isEquity,
      };
      // Prefer the Robinhood-branded feed when a ticker appears twice.
      const existing = feeds.get(info.symbol);
      if (!existing || (info.isEquity && !existing.isEquity)) feeds.set(info.symbol, info);
    }
    if (feeds.size === 0) throw new Error("Chainlink directory returned no usable feeds");
    return feeds;
  });
}

export interface PricePoint {
  /** Unix seconds */
  time: number;
  price: number;
}

export interface FeedQuote {
  symbol: string;
  price: number;
  updatedAt: number;
  roundId: bigint;
  stale: boolean;
}

/**
 * Some feeds carry bring-up rounds from before mainnet launch whose answers are
 * scaled differently from what `decimals()` now reports; on the SPY feed these
 * come back 1e10 too large. A single such point wrecks every indicator, so
 * points far from the median are dropped.
 *
 * The cutoff is deliberately wide. No equity moves 10x inside the few months of
 * history available here, but a decimal mismatch is off by many orders of
 * magnitude, so this separates the two without touching real volatility.
 */
const OUTLIER_FACTOR = 10;

export function sanitizePricePoints(points: PricePoint[]): PricePoint[] {
  if (points.length < 3) return points;
  const sorted = points.map((p) => p.price).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return points;
  return points.filter((p) => p.price <= median * OUTLIER_FACTOR && p.price >= median / OUTLIER_FACTOR);
}

/** Split a proxy roundId into its phase and per-aggregator round number. */
function splitRoundId(roundId: bigint): { phase: bigint; round: bigint } {
  return { phase: roundId >> 64n, round: roundId & ((1n << 64n) - 1n) };
}

function joinRoundId(phase: bigint, round: bigint): bigint {
  return (phase << 64n) | round;
}

export async function getLatestQuotes(feeds: FeedInfo[]): Promise<Map<string, FeedQuote>> {
  const client = getPublicClient();
  const results = await client.multicall({
    contracts: feeds.map((f) => ({ address: f.proxyAddress, abi: aggregatorV3Abi, functionName: "latestRoundData" as const })),
    allowFailure: true,
  });
  const now = Math.floor(Date.now() / 1000);
  const out = new Map<string, FeedQuote>();
  results.forEach((r, i) => {
    if (r.status !== "success") return;
    const [roundId, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    if (answer <= 0n || updatedAt === 0n) return;
    const feed = feeds[i];
    out.set(feed.symbol, {
      symbol: feed.symbol,
      price: Number(answer) / 10 ** feed.decimals,
      updatedAt: Number(updatedAt),
      roundId,
      // Chainlink's own staleness rule, with slack for block-time jitter.
      stale: now - Number(updatedAt) > feed.heartbeat * 1.5,
    });
  });
  return out;
}

/**
 * Read the most recent `count` rounds for a feed, newest first in round order
 * but returned oldest-first by time. Stops at the start of the current phase.
 */
export async function getRoundHistory(feed: FeedInfo, count: number): Promise<PricePoint[]> {
  const client = getPublicClient();
  const latest = await client.readContract({
    address: feed.proxyAddress,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
  });
  const [latestRoundId, latestAnswer, , latestUpdatedAt] = latest;
  const { phase, round } = splitRoundId(latestRoundId);

  const points: PricePoint[] = [];
  if (latestAnswer > 0n && latestUpdatedAt > 0n) {
    points.push({ time: Number(latestUpdatedAt), price: Number(latestAnswer) / 10 ** feed.decimals });
  }

  const oldest = round > BigInt(count) ? round - BigInt(count) : 1n;
  const wanted: bigint[] = [];
  for (let r = round - 1n; r >= oldest; r--) wanted.push(joinRoundId(phase, r));

  // Chunk so a single multicall stays well inside the public RPC's limits.
  const CHUNK = 220;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const slice = wanted.slice(i, i + CHUNK);
    const results = await client.multicall({
      contracts: slice.map((id) => ({
        address: feed.proxyAddress,
        abi: aggregatorV3Abi,
        functionName: "getRoundData" as const,
        args: [id] as const,
      })),
      allowFailure: true,
    });
    for (const r of results) {
      if (r.status !== "success") continue;
      const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      if (answer <= 0n || updatedAt === 0n) continue;
      points.push({ time: Number(updatedAt), price: Number(answer) / 10 ** feed.decimals });
    }
  }

  points.sort((a, b) => a.time - b.time);
  return sanitizePricePoints(points);
}

/**
 * Same history as getRoundHistory, but for every feed in one multicall.
 * The market list used to fan this out as one RPC per ticker, which is what
 * made the public endpoint stall.
 */
export async function getRoundHistories(
  specs: { symbol: string; feed: FeedInfo; latest: FeedQuote }[],
  count: number,
): Promise<Map<string, PricePoint[]>> {
  const client = getPublicClient();
  const out = new Map<string, PricePoint[]>();
  const jobs: { symbol: string; proxy: `0x${string}`; decimals: number; id: bigint }[] = [];

  for (const spec of specs) {
    out.set(spec.symbol, [{ time: spec.latest.updatedAt, price: spec.latest.price }]);
    const { phase, round } = splitRoundId(spec.latest.roundId);
    const oldest = round > BigInt(count) ? round - BigInt(count) : 1n;
    for (let r = round - 1n; r >= oldest; r--) {
      jobs.push({
        symbol: spec.symbol,
        proxy: spec.feed.proxyAddress,
        decimals: spec.feed.decimals,
        id: joinRoundId(phase, r),
      });
    }
  }

  const CHUNK = 400;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const slice = jobs.slice(i, i + CHUNK);
    const results = await client.multicall({
      contracts: slice.map((job) => ({
        address: job.proxy,
        abi: aggregatorV3Abi,
        functionName: "getRoundData" as const,
        args: [job.id] as const,
      })),
      allowFailure: true,
    });
    results.forEach((result, j) => {
      if (result.status !== "success") return;
      const [, answer, , updatedAt] = result.result as readonly [bigint, bigint, bigint, bigint, bigint];
      if (answer <= 0n || updatedAt === 0n) return;
      const job = slice[j];
      out.get(job.symbol)?.push({
        time: Number(updatedAt),
        price: Number(answer) / 10 ** job.decimals,
      });
    });
  }

  for (const [symbol, points] of out) {
    points.sort((a, b) => a.time - b.time);
    out.set(symbol, sanitizePricePoints(points));
  }
  return out;
}
