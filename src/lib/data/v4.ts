import { decodeAbiParameters, encodeAbiParameters, getAddress, hexToBigInt, keccak256, parseAbi, parseAbiItem } from "viem";
import { cache } from "../cache";
import { getLogsClient, getPublicClient } from "../chain/client";
import { PONS_V2_FACTORY, V4_POOL_MANAGER } from "../chain/constants";
import { blockClock, blocksFor, blockTime, RollingWindow, spanned, type BlockClock } from "../chain/logs";
import { safetyScore } from "../safety/score";
import type { Candle, TokenMarket } from "../types";
import type { Timeframe } from "../types";
import { findGraduation, findLaunch, quoteOf, type PonsLaunch, type QuoteBook, type QuoteInfo } from "./pons";
import { getPonsProfiles } from "./ponsProfile";
import { holdersFrom, tradeCandles, transfers, type PonsTokenDetail, type PonsTrade } from "./ponsToken";
import { getTokenMeta } from "./tokenMeta";

/**
 * Graduated Pons launches trade in a Uniswap v4 pool. v4 keeps all pools in
 * one PoolManager, so a pool is found from its graduation transaction's
 * Initialize event, priced from its slot0 storage, and its trades are the
 * PoolManager's Swap events filtered by pool id.
 */

const INITIALIZE_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const POOLS_SLOT = 6n;
const extsloadAbi = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);
const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
/** Three days of trades: enough for 5m to 4h candles without walking a busy PoolManager for weeks. */
const HISTORY_SECONDS = 3 * 24 * 3600;
const HISTORY_TTL = 15 * 1000;
const TOKEN_DECIMALS = 18;

export interface V4Pool {
  id: `0x${string}`;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
  /** True when the launch token is currency0. */
  tokenIs0: boolean;
}

export interface GraduatedToken {
  launch: PonsLaunch;
  pool: V4Pool;
  graduatedAt: number;
  seedPairAmount: bigint;
}

/** The v4 pool a graduated launch was seeded into, or null if it has not graduated. */
export async function graduatedPool(token: string): Promise<GraduatedToken | null> {
  return cache.get(`v4:pool:${token.toLowerCase()}`, 60 * 60 * 1000, async () => {
    const launch = await findLaunch(token);
    if (!launch) return null;
    const grad = await findGraduation(launch);
    if (!grad) return null;
    const receipt = await getPublicClient().getTransactionReceipt({ hash: grad.tx });
    const init = receipt.logs.find(
      (l) => l.address.toLowerCase() === V4_POOL_MANAGER.toLowerCase() && l.topics[0] === INITIALIZE_TOPIC,
    );
    if (!init || init.topics.length < 4) return null;
    const [fee, tickSpacing, hooks] = decodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }], init.data);
    const currency0 = getAddress(`0x${init.topics[2]!.slice(26)}`);
    const currency1 = getAddress(`0x${init.topics[3]!.slice(26)}`);
    const clock = await blockClock();
    return {
      launch,
      pool: {
        id: init.topics[1] as `0x${string}`,
        currency0,
        currency1,
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        hooks: hooks as `0x${string}`,
        tokenIs0: currency0.toLowerCase() === launch.token.toLowerCase(),
      },
      graduatedAt: blockTime(clock, grad.block),
      seedPairAmount: grad.pairTokenAmount,
    };
  });
}

/** keccak256(abi.encode(key)): the id a pool key hashes to. */
export function v4PoolId(key: Omit<V4Pool, "id" | "tokenIs0">): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Pair-asset units per whole launch token, from a v4 sqrtPriceX96. */
export function pairPerToken(sqrtPriceX96: bigint, tokenIs0: boolean, pairDecimals: number): number {
  const raw = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // raw currency1 per raw currency0
  if (!(raw > 0)) return 0;
  const scale = 10 ** (TOKEN_DECIMALS - pairDecimals);
  return tokenIs0 ? raw * scale : (1 / raw) * scale;
}

async function readSqrtPrice(id: `0x${string}`): Promise<bigint> {
  const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, POOLS_SLOT]));
  const raw = await getPublicClient().readContract({ address: V4_POOL_MANAGER, abi: extsloadAbi, functionName: "extsload", args: [slot] });
  return hexToBigInt(raw) & ((1n << 160n) - 1n);
}

interface RawSwap {
  block: bigint;
  logIndex: number;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  tx: `0x${string}`;
}

const windows = new Map<string, RollingWindow<RawSwap>>();

async function poolSwaps(id: `0x${string}`): Promise<RawSwap[]> {
  let w = windows.get(id);
  if (!w) {
    if (windows.size > 200) windows.delete(windows.keys().next().value!);
    w = new RollingWindow<RawSwap>(
      blocksFor(HISTORY_SECONDS),
      spanned(300_000n, 1, async (a, b) => {
        const logs = await getLogsClient().getLogs({ address: V4_POOL_MANAGER, event: SWAP, args: { id }, fromBlock: a, toBlock: b });
        return logs.flatMap((l) => {
          const { amount0, amount1, sqrtPriceX96 } = l.args;
          if (amount0 === undefined || amount1 === undefined || sqrtPriceX96 === undefined || !l.transactionHash) return [];
          return [{ block: l.blockNumber ?? 0n, logIndex: l.logIndex ?? 0, amount0, amount1, sqrtPriceX96, tx: l.transactionHash }];
        });
      }),
    );
    windows.set(id, w);
  }
  const window = w;
  return cache.get(`v4:swaps:${id}`, HISTORY_TTL, async () => window.refresh((await blockClock()).head), { swr: true });
}

/** Swaps as trades, oldest first. Deltas are the swapper's: a positive token delta is a buy. */
export function priceV4Swaps(raw: RawSwap[], pool: V4Pool, quote: QuoteInfo, clock: BlockClock): PonsTrade[] {
  const sorted = [...raw].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  return sorted.flatMap((s) => {
    const tokenDelta = pool.tokenIs0 ? s.amount0 : s.amount1;
    const pairDelta = pool.tokenIs0 ? s.amount1 : s.amount0;
    const tokens = Math.abs(Number(tokenDelta)) / 10 ** TOKEN_DECIMALS;
    const pair = Math.abs(Number(pairDelta)) / 10 ** quote.decimals;
    if (!(tokens > 0) || !(pair > 0)) return [];
    return [
      {
        id: `${s.tx}:${s.logIndex}`,
        time: blockTime(clock, s.block),
        side: tokenDelta > 0n ? ("buy" as const) : ("sell" as const),
        priceUsd: pairPerToken(s.sqrtPriceX96, pool.tokenIs0, quote.decimals) * quote.usd,
        usd: pair * quote.usd,
        tokens,
        trader: null,
        tx: s.tx,
      },
    ];
  });
}

/** Market row for a graduated launch. Null if the token never graduated from Pons. */
export async function graduatedMarket(token: string, book: QuoteBook): Promise<{ market: TokenMarket; grad: GraduatedToken; trades: PonsTrade[] } | null> {
  const grad = await graduatedPool(token);
  if (!grad) return null;
  const quote = quoteOf(grad.launch.pairToken, book);
  if (!quote) return null;
  const key = grad.launch.token.toLowerCase();
  const [clock, sqrt, raw, meta, profiles] = await Promise.all([
    blockClock(),
    readSqrtPrice(grad.pool.id),
    poolSwaps(grad.pool.id).catch(() => [] as RawSwap[]),
    getTokenMeta([grad.launch.token]),
    getPonsProfiles([grad.launch.token]).catch(() => new Map()),
  ]);
  const m = meta.get(key);
  if (!m) return null;
  const trades = priceV4Swaps(raw, grad.pool, quote, clock);
  const priceUsd = pairPerToken(sqrt, grad.pool.tokenIs0, quote.decimals) * quote.usd;
  const dayAgo = clock.headTime - 86_400;
  const day = trades.filter((t) => t.time >= dayAgo);
  const open = day[0]?.priceUsd ?? null;
  const profile = profiles.get(key);
  const seedUsd = (Number(grad.seedPairAmount) / 10 ** quote.decimals) * quote.usd * 2;
  return {
    grad,
    trades,
    market: {
      token: { address: grad.launch.token, symbol: m.symbol, name: m.name, decimals: m.decimals, logoUrl: profile?.logoUrl ?? undefined },
      poolAddress: V4_POOL_MANAGER,
      feeTier: grad.pool.fee,
      quoteSymbol: quote.symbol,
      priceUsd,
      oraclePriceUsd: null,
      oracleBasisPct: null,
      oracleUpdatedAt: null,
      oracleStale: false,
      liquidityUsd: seedUsd,
      volume24hUsd: day.reduce((s, t) => s + t.usd, 0),
      priceChange1hPct: null,
      priceChange24hPct: open ? ((priceUsd - open) / open) * 100 : null,
      txCount24h: day.length,
      createdAt: null,
      tradableNow: false,
      hasPriceHistory: trades.length > 0,
      venue: "pons",
      profile: profile ? { description: profile.description, socials: profile.socials } : undefined,
      graduated: { poolId: grad.pool.id, at: grad.graduatedAt },
    },
  };
}

export async function graduatedCandles(market: TokenMarket, book: QuoteBook, timeframe: Timeframe, limit: number): Promise<Candle[]> {
  const found = await graduatedMarket(market.token.address, book);
  if (!found) throw new Error(`${market.token.symbol} is not a graduated Pons launch`);
  return tradeCandles(found.trades, timeframe, limit);
}

/** The token panel for a graduated launch: same shape as a live curve's. */
export async function graduatedDetail(token: string, book: QuoteBook): Promise<PonsTokenDetail | null> {
  const found = await graduatedMarket(token, book);
  if (!found) return null;
  const { market, grad, trades } = found;
  const [clock, moves] = await Promise.all([blockClock(), transfers(grad.launch).catch(() => [])]);
  const labels = new Map<string, "curve" | "deployer" | "burn" | null>([
    [grad.launch.curve.toLowerCase(), "curve"],
    [grad.launch.deployer.toLowerCase(), "deployer"],
    [getAddress(PONS_V2_FACTORY).toLowerCase(), "curve"],
    [V4_POOL_MANAGER.toLowerCase(), "curve"],
  ]);
  const { holders, count } = holdersFrom(moves, labels);
  const stats = { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, traders: 0 };
  for (const t of trades) {
    if (t.side === "buy") {
      stats.buys += 1;
      stats.buyUsd += t.usd;
    } else {
      stats.sells += 1;
      stats.sellUsd += t.usd;
    }
  }
  stats.traders = count;
  const launchedAt = blockTime(clock, grad.launch.block);
  return {
    market,
    launchedAt,
    deployer: grad.launch.deployer,
    trades: trades.slice(-80).reverse(),
    holders,
    holderCount: count,
    stats,
    safety: safetyScore({
      ageSeconds: Math.max(0, clock.headTime - launchedAt),
      holders,
      deployer: grad.launch.deployer,
      trades,
      traders: count,
      raisedUsd: market.liquidityUsd / 2,
    }),
  };
}
