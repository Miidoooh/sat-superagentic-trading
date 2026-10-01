import { getAddress, parseAbi, parseAbiItem } from "viem";
import { PONS_V2_FACTORY, USDG } from "../chain/constants";
import { getLogsClient, getPublicClient } from "../chain/client";
import { blockClock, getLogsAdaptive, mapPool, RollingWindow } from "../chain/logs";
import { multicallStrict } from "../chain/multicall";
import { cache } from "../cache";
import type { TokenMarket } from "../types";
import { getPonsProfiles, type PonsProfile } from "./ponsProfile";
import { getTokenMeta } from "./tokenMeta";

/**
 * Pons V2 launchpad on Robinhood Chain. There is no indexer: the token list is
 * the factory's TokenLaunched logs, and the price is the bonding curve's own
 * reserves. Graduated launches leave the curve, so a reverted getReserves means
 * "now trading in its Uniswap v4 pool" and is left out.
 *
 * getReserves() includes the curve's virtual quote reserve (1.68 ETH on the
 * default config), so it prices trades but overstates what was raised.
 * realQuoteReserve() is the quote actually deposited; the launch graduates when
 * it reaches graduationThreshold.
 */

const TOKEN_LAUNCHED = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
const POOL_GRADUATED = parseAbiItem(
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
);
/** ~42 hours. The node caps a log query at 10,000 results, so this is walked in slices. */
const LOOKBACK_BLOCKS = 1_500_000n;
const LOG_SPAN = 350_000n;
const CATALOG_TTL = 10 * 60 * 1000;
const CATALOG_WAIT_MS = 6 * 1000;
/** Just under the node's 10M-block limit on a single log query (~11 days). */
const FIND_LAUNCH_BLOCKS = 9_900_000n;
/** The Pons V2 factory's first launch is just above this block. */
export const PONS_START_BLOCK = 27_000_000n;
/** ~1 hour of launches, refreshed incrementally so new tokens appear within seconds. */
const RECENT_BLOCKS = 36_000n;
const RECENT_TTL = 10 * 1000;
const SCAN_TTL = 45 * 1000;
/** ~25 hours of graduations. */
const GRADUATION_BLOCKS = 900_000n;
const GRADUATION_TTL = 2 * 60 * 1000;
const ZERO = "0x0000000000000000000000000000000000000000";
/** Newest curves we price. */
const MAX_CURVES = 4_000;
const CURVES_PER_CALL = 250;
const MAX_LISTED = 100;
const MIN_RAISED_USD = 500;

const curveAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
]);

export interface PonsLaunch {
  token: `0x${string}`;
  curve: `0x${string}`;
  deployer: `0x${string}`;
  pairToken: `0x${string}`;
  threshold: bigint;
  block: bigint;
}

export interface QuoteInfo {
  usd: number;
  decimals: number;
  symbol: string;
}

export interface QuoteBook {
  ethUsd: number;
  /** Lowercase address → USD price and decimals of that quote asset. */
  byAddress: Map<string, QuoteInfo>;
}

export interface CurveState {
  launch: PonsLaunch;
  quote: QuoteInfo;
  /** Spot price assuming 18 token decimals (every Pons launch so far). */
  priceUsd: number;
  raisedUsd: number;
  thresholdUsd: number;
  /** 0..1 */
  progress: number;
}

/** Spot price of one whole token, in USD, from constant-product reserves. */
export function curveSpotUsd(
  quoteReserve: bigint,
  tokenReserve: bigint,
  quoteDecimals: number,
  tokenDecimals: number,
  quoteUsd: number,
): number | null {
  if (quoteReserve <= 0n || tokenReserve <= 0n || !(quoteUsd > 0)) return null;
  const quote = Number(quoteReserve) / 10 ** quoteDecimals;
  const tokens = Number(tokenReserve) / 10 ** tokenDecimals;
  if (!Number.isFinite(quote) || !Number.isFinite(tokens) || tokens <= 0 || quote <= 0) return null;
  const price = (quote / tokens) * quoteUsd;
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Share of the graduation threshold already raised, clamped to 0..1. */
export function curveProgress(realQuote: bigint, threshold: bigint): number {
  if (threshold <= 0n || realQuote <= 0n) return 0;
  const ratio = Number((realQuote * 10_000n) / threshold) / 10_000;
  return Math.min(1, Math.max(0, ratio));
}

export function quoteOf(pairToken: string, book: QuoteBook): QuoteInfo | null {
  const pair = pairToken.toLowerCase();
  if (pair === ZERO) return book.ethUsd > 0 ? { usd: book.ethUsd, decimals: 18, symbol: "ETH" } : null;
  if (pair === USDG.address.toLowerCase()) return { usd: 1, decimals: USDG.decimals, symbol: USDG.symbol };
  return book.byAddress.get(pair) ?? null;
}

async function readLaunches(from: bigint, to: bigint): Promise<PonsLaunch[]> {
  const logs = await getLogsClient().getLogs({
    address: getAddress(PONS_V2_FACTORY),
    event: TOKEN_LAUNCHED,
    fromBlock: from,
    toBlock: to,
  });
  const out: PonsLaunch[] = [];
  for (const log of logs) {
    const { token, curve, deployer, pairToken, graduationThreshold } = log.args;
    if (!token || !curve || !deployer || !pairToken || graduationThreshold === undefined) continue;
    out.push({ token, curve, deployer, pairToken, threshold: graduationThreshold, block: log.blockNumber ?? 0n });
  }
  return out;
}

async function catalogLaunches(): Promise<PonsLaunch[]> {
  return cache.get(
    "pons:catalog",
    CATALOG_TTL,
    async () => {
      const { head } = await blockClock();
      const start = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
      const spans: { from: bigint; to: bigint }[] = [];
      for (let from = start; from <= head; from += LOG_SPAN) {
        spans.push({ from, to: from + LOG_SPAN - 1n > head ? head : from + LOG_SPAN - 1n });
      }
      const batches = await mapPool(spans, 3, (span) => getLogsAdaptive(span.from, span.to, readLaunches));
      return batches.flat();
    },
    { swr: true },
  );
}

const recentWindow = new RollingWindow<PonsLaunch>(RECENT_BLOCKS, readLaunches);

export async function recentLaunches(): Promise<PonsLaunch[]> {
  return cache.get("pons:recent", RECENT_TTL, async () => recentWindow.refresh((await blockClock()).head), {
    swr: true,
  });
}

/**
 * Every launch inside the lookback, newest first. A cold catalog walk takes
 * about a minute, so until it lands this returns the last hour of launches
 * and lets the walk finish in the background.
 */
export async function listLaunches(): Promise<PonsLaunch[]> {
  const catalog = catalogLaunches();
  catalog.catch(() => undefined);
  const [recent, older] = await Promise.all([
    recentLaunches().catch(() => [] as PonsLaunch[]),
    Promise.race([
      catalog.catch(() => [] as PonsLaunch[]),
      new Promise<PonsLaunch[]>((resolve) => setTimeout(() => resolve([]), CATALOG_WAIT_MS)),
    ]),
  ]);
  if (recent.length === 0 && older.length === 0) throw new Error("Pons launch logs unavailable");
  const seen = new Set<string>();
  const out: PonsLaunch[] = [];
  for (const launch of [...recent, ...older]) {
    const key = launch.token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(launch);
  }
  return out.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
}

/** The launch record for one token, even if it predates the cached catalog. */
export async function findLaunch(token: string): Promise<PonsLaunch | null> {
  const key = token.toLowerCase();
  const listed = (await listLaunches().catch(() => [] as PonsLaunch[])).find((l) => l.token.toLowerCase() === key);
  if (listed) return listed;
  return cache.get(`pons:launch:${key}`, CATALOG_TTL, async () => {
    const { head } = await blockClock();
    // Filtered by token, each window is one cheap query; walk back to the factory's first launch.
    for (let to = head; to > PONS_START_BLOCK; to -= FIND_LAUNCH_BLOCKS) {
      const from = to - FIND_LAUNCH_BLOCKS + 1n > PONS_START_BLOCK ? to - FIND_LAUNCH_BLOCKS + 1n : PONS_START_BLOCK;
      const logs = await getLogsAdaptive(from, to, (a, b) =>
        getLogsClient().getLogs({ address: getAddress(PONS_V2_FACTORY), event: TOKEN_LAUNCHED, args: { token: getAddress(token) }, fromBlock: a, toBlock: b }),
      );
      const log = logs[0];
      const { curve, deployer, pairToken, graduationThreshold } = log?.args ?? {};
      if (!log || !curve || !deployer || !pairToken || graduationThreshold === undefined) continue;
      return { token: getAddress(token), curve, deployer, pairToken, threshold: graduationThreshold, block: log.blockNumber ?? 0n };
    }
    return null;
  });
}

/** The graduation of one launch, if it has graduated: the block and transaction that seeded its pool. */
export async function findGraduation(launch: PonsLaunch): Promise<PonsGraduation | null> {
  return cache.get(`pons:graduation:${launch.token.toLowerCase()}`, CATALOG_TTL, async () => {
    const { head } = await blockClock();
    for (let from = launch.block; from <= head; from += FIND_LAUNCH_BLOCKS) {
      const to = from + FIND_LAUNCH_BLOCKS - 1n < head ? from + FIND_LAUNCH_BLOCKS - 1n : head;
      const logs = await getLogsAdaptive(from, to, (a, b) =>
        getLogsClient().getLogs({ address: getAddress(PONS_V2_FACTORY), event: POOL_GRADUATED, args: { token: launch.token }, fromBlock: a, toBlock: b }),
      );
      const log = logs[0];
      const { tokenAmount, pairTokenAmount } = log?.args ?? {};
      if (!log || tokenAmount === undefined || pairTokenAmount === undefined || !log.transactionHash) continue;
      return { token: launch.token, block: log.blockNumber ?? 0n, tx: log.transactionHash, tokenAmount, pairTokenAmount };
    }
    return null;
  });
}

/** Read live curve state. Graduated curves revert and are omitted. */
export async function readCurveStates(launches: PonsLaunch[], book: QuoteBook): Promise<CurveState[]> {
  const client = getPublicClient();
  const out: CurveState[] = [];
  for (let i = 0; i < launches.length; i += CURVES_PER_CALL) {
    const slice = launches.slice(i, i + CURVES_PER_CALL);
    const results = await multicallStrict(
      client,
      slice.flatMap((l) => [
        { address: l.curve, abi: curveAbi, functionName: "getReserves" as const },
        { address: l.curve, abi: curveAbi, functionName: "realQuoteReserve" as const },
      ]),
    );
    slice.forEach((launch, j) => {
      const reserves = results[j * 2];
      const real = results[j * 2 + 1];
      if (reserves.status !== "success" || real.status !== "success") return;
      const quote = quoteOf(launch.pairToken, book);
      if (!quote) return;
      const [quoteReserve, tokenReserve] = reserves.result as readonly [bigint, bigint];
      const priceUsd = curveSpotUsd(quoteReserve, tokenReserve, quote.decimals, 18, quote.usd);
      if (priceUsd === null) return;
      const unit = 10 ** quote.decimals;
      out.push({
        launch,
        quote,
        priceUsd,
        raisedUsd: (Number(real.result as bigint) / unit) * quote.usd,
        thresholdUsd: (Number(launch.threshold) / unit) * quote.usd,
        progress: curveProgress(real.result as bigint, launch.threshold),
      });
    });
  }
  return out;
}

/** Live state of the newest curves. Shared by the market list and the trenches. */
export async function scanCurves(book: QuoteBook): Promise<CurveState[]> {
  return cache.get(
    "pons:scan",
    SCAN_TTL,
    async () => readCurveStates((await listLaunches()).slice(0, MAX_CURVES), book),
    { swr: true },
  );
}

export function curveMarket(state: CurveState, meta: { symbol: string; name: string; decimals: number }, profile?: PonsProfile): TokenMarket {
  const decimals = meta.decimals;
  return {
    token: { address: state.launch.token, symbol: meta.symbol, name: meta.name, decimals, logoUrl: profile?.logoUrl ?? undefined },
    profile: profile ? { description: profile.description, socials: profile.socials } : undefined,
    poolAddress: state.launch.curve,
    feeTier: 0,
    quoteSymbol: state.quote.symbol,
    // Reserves were scaled as 18 decimals. Rescale if the token disagrees.
    priceUsd: decimals === 18 ? state.priceUsd : state.priceUsd * 10 ** (decimals - 18),
    oraclePriceUsd: null,
    oracleBasisPct: null,
    oracleUpdatedAt: null,
    oracleStale: false,
    liquidityUsd: state.raisedUsd,
    volume24hUsd: null,
    priceChange1hPct: null,
    priceChange24hPct: null,
    txCount24h: null,
    createdAt: null,
    tradableNow: true,
    hasPriceHistory: false,
    venue: "pons",
    curve: {
      progressPct: Number((state.progress * 100).toFixed(2)),
      raisedUsd: state.raisedUsd,
      thresholdUsd: state.thresholdUsd,
    },
  };
}

/** Live Pons markets with the most real quote raised. Failure of one curve never fails the list. */
export async function listPonsMarkets(book: QuoteBook): Promise<TokenMarket[]> {
  const top = (await scanCurves(book))
    .filter((s) => s.raisedUsd >= MIN_RAISED_USD)
    .sort((a, b) => b.raisedUsd - a.raisedUsd)
    .slice(0, MAX_LISTED);
  if (top.length === 0) return [];
  const tokens = top.map((s) => s.launch.token);
  const [meta, profiles] = await Promise.all([getTokenMeta(tokens), getPonsProfiles(tokens).catch(() => new Map<string, PonsProfile>())]);
  return top.flatMap((s) => {
    const key = s.launch.token.toLowerCase();
    const m = meta.get(key);
    return m ? [curveMarket(s, m, profiles.get(key))] : [];
  });
}

export interface PonsGraduation {
  token: `0x${string}`;
  block: bigint;
  tx: `0x${string}`;
  tokenAmount: bigint;
  pairTokenAmount: bigint;
}

const graduationWindow = new RollingWindow<PonsGraduation>(GRADUATION_BLOCKS, async (from, to) => {
  const logs = await getLogsClient().getLogs({
    address: getAddress(PONS_V2_FACTORY),
    event: POOL_GRADUATED,
    fromBlock: from,
    toBlock: to,
  });
  const out: PonsGraduation[] = [];
  for (const log of logs) {
    const { token, tokenAmount, pairTokenAmount } = log.args;
    if (!token || tokenAmount === undefined || pairTokenAmount === undefined || !log.transactionHash) continue;
    out.push({ token, block: log.blockNumber ?? 0n, tx: log.transactionHash, tokenAmount, pairTokenAmount });
  }
  return out;
});

/** Launches that filled their curve in the last ~25 hours, newest first. */
export async function recentGraduations(): Promise<PonsGraduation[]> {
  return cache.get(
    "pons:graduations",
    GRADUATION_TTL,
    async () => {
      const items = await graduationWindow.refresh((await blockClock()).head);
      return [...items].sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
    },
    { swr: true },
  );
}
