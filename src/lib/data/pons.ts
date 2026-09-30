import { getAddress, parseAbi, parseAbiItem } from "viem";
import { PONS_V2_FACTORY, USDG } from "../chain/constants";
import { getPublicClient } from "../chain/client";
import { cache } from "../cache";
import type { TokenMarket } from "../types";

/**
 * Pons V2 launchpad on Robinhood Chain. There is no indexer: the token list is
 * the factory's TokenLaunched logs, and the price is the bonding curve's own
 * reserves. Graduated launches leave the curve, so a reverted getReserves means
 * "now trading in its Uniswap v4 pool" and is left out.
 *
 * TokenLaunched(address indexed token, address indexed curve, address indexed deployer,
 *               address pairToken, uint256 launchConfigId, uint256 graduationThreshold)
 */

const TOKEN_LAUNCHED = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
/** ~42 hours. The node caps a log query at 10,000 results, so this is walked in slices. */
const LOOKBACK_BLOCKS = 1_500_000n;
const LOG_SPAN = 350_000n;
const LAUNCH_TTL = 10 * 60 * 1000;
const ZERO = "0x0000000000000000000000000000000000000000";
/** Newest curves we price. Older than this window is still listed once it is inside the lookback. */
const MAX_CURVES = 4_000;
const MAX_LISTED = 48;
const MIN_LIQUIDITY_USD = 2_500;

const curveAbi = parseAbi(["function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)"]);
const metaAbi = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface PonsLaunch {
  token: `0x${string}`;
  curve: `0x${string}`;
  pairToken: `0x${string}`;
  block: number;
}

export interface QuoteBook {
  ethUsd: number;
  /** Lowercase address → USD price and decimals of that quote asset. */
  byAddress: Map<string, { usd: number; decimals: number; symbol: string }>;
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

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export async function listLaunches(): Promise<PonsLaunch[]> {
  return cache.get("pons:launches", LAUNCH_TTL, async () => {
    const client = getPublicClient();
    const head = await client.getBlockNumber();
    const start = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
    const spans: { from: bigint; to: bigint }[] = [];
    for (let from = start; from <= head; from += LOG_SPAN) {
      const to = from + LOG_SPAN - 1n > head ? head : from + LOG_SPAN - 1n;
      spans.push({ from, to });
    }

    const batches = await mapPool(spans, 3, (span) =>
      client.getLogs({
        address: getAddress(PONS_V2_FACTORY),
        event: TOKEN_LAUNCHED,
        fromBlock: span.from,
        toBlock: span.to,
      }),
    );

    const seen = new Set<string>();
    const launches: PonsLaunch[] = [];
    for (const logs of batches) {
      for (const log of logs) {
        const token = log.args.token;
        const curve = log.args.curve;
        const pairToken = log.args.pairToken;
        if (!token || !curve || !pairToken) continue;
        if (seen.has(token)) continue;
        seen.add(token);
        launches.push({
          token,
          curve,
          pairToken,
          block: Number(log.blockNumber ?? 0n),
        });
      }
    }
    launches.sort((a, b) => b.block - a.block);
    return launches;
  });
}

function quoteOf(launch: PonsLaunch, book: QuoteBook): { usd: number; decimals: number; symbol: string } | null {
  if (launch.pairToken.toLowerCase() === ZERO) {
    return book.ethUsd > 0 ? { usd: book.ethUsd, decimals: 18, symbol: "ETH" } : null;
  }
  if (launch.pairToken.toLowerCase() === USDG.address.toLowerCase()) {
    return { usd: 1, decimals: USDG.decimals, symbol: USDG.symbol };
  }
  return book.byAddress.get(launch.pairToken.toLowerCase()) ?? null;
}

/**
 * Live Pons markets, deepest curve first. Failure of one curve never fails the list.
 */
export async function listPonsMarkets(book: QuoteBook): Promise<TokenMarket[]> {
  const launches = (await listLaunches()).slice(0, MAX_CURVES);
  if (launches.length === 0) return [];

  const client = getPublicClient();
  const priced: { launch: PonsLaunch; priceUsd: number; liquidityUsd: number; quoteSymbol: string }[] = [];
  const CHUNK = 500;

  for (let i = 0; i < launches.length; i += CHUNK) {
    const slice = launches.slice(i, i + CHUNK);
    const results = await client.multicall({
      contracts: slice.map((l) => ({ address: l.curve, abi: curveAbi, functionName: "getReserves" as const })),
      allowFailure: true,
    });
    results.forEach((result, j) => {
      if (result.status !== "success") return;
      const [quoteReserve, tokenReserve] = result.result as readonly [bigint, bigint];
      const launch = slice[j];
      const quote = quoteOf(launch, book);
      if (!quote) return;
      const priceUsd = curveSpotUsd(quoteReserve, tokenReserve, quote.decimals, 18, quote.usd);
      if (priceUsd === null) return;
      // Quote reserve is the side a seller can actually exit into.
      const liquidityUsd = (Number(quoteReserve) / 10 ** quote.decimals) * quote.usd;
      if (!Number.isFinite(liquidityUsd) || liquidityUsd < MIN_LIQUIDITY_USD) return;
      priced.push({ launch, priceUsd, liquidityUsd, quoteSymbol: quote.symbol });
    });
  }

  priced.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  const top = priced.slice(0, MAX_LISTED);
  if (top.length === 0) return [];

  const meta = await client.multicall({
    contracts: top.flatMap((row) => [
      { address: row.launch.token, abi: metaAbi, functionName: "symbol" as const },
      { address: row.launch.token, abi: metaAbi, functionName: "name" as const },
      { address: row.launch.token, abi: metaAbi, functionName: "decimals" as const },
    ]),
    allowFailure: true,
  });

  const markets: TokenMarket[] = [];
  top.forEach((row, i) => {
    const symbol = meta[i * 3];
    const name = meta[i * 3 + 1];
    const decimals = meta[i * 3 + 2];
    if (symbol.status !== "success" || name.status !== "success" || decimals.status !== "success") return;
    const tokenDecimals = Number(decimals.result);
    // Reserves were scaled as 18. Recompute if the token disagrees.
    const priceUsd =
      tokenDecimals === 18
        ? row.priceUsd
        : row.priceUsd * 10 ** (tokenDecimals - 18);
    markets.push({
      token: {
        address: row.launch.token,
        symbol: String(symbol.result),
        name: String(name.result),
        decimals: tokenDecimals,
      },
      poolAddress: row.launch.curve,
      feeTier: 0,
      quoteSymbol: row.quoteSymbol,
      priceUsd,
      oraclePriceUsd: null,
      oracleBasisPct: null,
      oracleUpdatedAt: null,
      oracleStale: false,
      liquidityUsd: row.liquidityUsd,
      volume24hUsd: null,
      priceChange1hPct: null,
      priceChange24hPct: null,
      txCount24h: null,
      createdAt: null,
      tradableNow: true,
      hasPriceHistory: false,
      venue: "pons",
    });
  });
  return markets;
}

