import { encodeAbiParameters, erc20Abi, getAddress, hexToBigInt, keccak256, parseAbi, parseAbiItem } from "viem";
import { cache } from "../cache";
import { getLogsClient, getPublicClient } from "../chain/client";
import { ponsTokenUrl, USDG, V4_POOL_MANAGER } from "../chain/constants";
import { blockClock, blocksFor, blockTime, RollingWindow, spanned } from "../chain/logs";
import { getConfig } from "../config";
import { nextTier, tierFor, type TierId, type TierThresholds } from "./tiers";

/**
 * SAT graduated from Pons into a Uniswap v4 pool (USDG / SAT, Pons hook).
 * v4 keeps every pool inside one PoolManager, so price is read from the pool's
 * slot0 storage with extsload and activity from Swap events filtered by pool id.
 */

export { V4_POOL_MANAGER };
const POOLS_SLOT = 6n;

export interface V4PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/** Verified from the graduation transaction's Initialize event. */
export const SAT_POOL_KEY: V4PoolKey = {
  currency0: USDG.address,
  currency1: "0xbe3f794bfb99399a4ea9cd5acf08529eea6e718a",
  fee: 0,
  tickSpacing: 200,
  hooks: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
};

const extsloadAbi = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);
const V4_SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

export function poolId(key: V4PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [getAddress(key.currency0), getAddress(key.currency1), key.fee, key.tickSpacing, getAddress(key.hooks)],
    ),
  );
}

/** USD per whole SAT from a v4 sqrtPriceX96, with USDG as currency0. */
export function satUsdFromSqrt(sqrtPriceX96: bigint): number {
  const raw = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // raw SAT per raw USDG
  const satPerUsd = raw * 10 ** (USDG.decimals - 18);
  return satPerUsd > 0 ? 1 / satPerUsd : 0;
}

export interface SatTrade {
  side: "buy" | "sell";
  usd: number;
  sat: number;
  priceUsd: number;
  time: number;
  tx: `0x${string}`;
}

export interface SatMarket {
  address: `0x${string}`;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCapUsd: number;
  change24hPct: number | null;
  volume24hUsd: number;
  trades24h: number;
  buys24h: number;
  recent: SatTrade[];
  buyUrl: string;
  explorerUrl: string;
  updatedAt: number;
}

const SUPPLY = 1_000_000_000;
const PRICE_TTL = 12_000;
const ACTIVITY_TTL = 45_000;

async function readSqrtPrice(): Promise<bigint> {
  const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId(SAT_POOL_KEY), POOLS_SLOT]));
  const raw = await getPublicClient().readContract({ address: V4_POOL_MANAGER, abi: extsloadAbi, functionName: "extsload", args: [slot] });
  return hexToBigInt(raw) & ((1n << 160n) - 1n);
}

export async function satPriceUsd(): Promise<number> {
  return cache.get("sat:price", PRICE_TTL, async () => satUsdFromSqrt(await readSqrtPrice()), { swr: true });
}

interface RawSatSwap {
  block: bigint;
  logIndex: number;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  tx: `0x${string}`;
}

/** The PoolManager is busy, so 24h is read in chunks once and then only new blocks. */
const swapWindow = new RollingWindow<RawSatSwap>(
  blocksFor(24 * 60 * 60),
  spanned(300_000n, 1, async (from, to) => {
    const logs = await getLogsClient().getLogs({ address: V4_POOL_MANAGER, event: V4_SWAP, args: { id: poolId(SAT_POOL_KEY) }, fromBlock: from, toBlock: to });
    const out: RawSatSwap[] = [];
    for (const log of logs) {
      const { amount0, amount1, sqrtPriceX96 } = log.args;
      if (amount0 === undefined || amount1 === undefined || sqrtPriceX96 === undefined || !log.transactionHash) continue;
      out.push({ block: log.blockNumber ?? 0n, logIndex: log.logIndex ?? 0, amount0, amount1, sqrtPriceX96, tx: log.transactionHash });
    }
    return out;
  }),
);

async function satActivity(): Promise<{ trades: SatTrade[]; firstPrice: number | null }> {
  return cache.get(
    "sat:activity",
    ACTIVITY_TTL,
    async () => {
      const clock = await blockClock();
      const raw = [...(await swapWindow.refresh(clock.head))].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
      const trades: SatTrade[] = raw.map((s) => ({
        // Deltas are from the swapper's side: positive is received.
        side: s.amount1 > 0n ? "buy" : "sell",
        usd: Math.abs(Number(s.amount0)) / 10 ** USDG.decimals,
        sat: Math.abs(Number(s.amount1)) / 1e18,
        priceUsd: satUsdFromSqrt(s.sqrtPriceX96),
        time: blockTime(clock, s.block),
        tx: s.tx,
      }));
      return { trades, firstPrice: trades[0]?.priceUsd ?? null };
    },
    { swr: true },
  );
}

export async function getSatMarket(): Promise<SatMarket> {
  const cfg = getConfig();
  const [priceUsd, activity] = await Promise.all([satPriceUsd(), satActivity().catch(() => ({ trades: [] as SatTrade[], firstPrice: null }))]);
  const { trades, firstPrice } = activity;
  const address = getAddress(cfg.SAT_TOKEN_ADDRESS);
  return {
    address,
    symbol: "SAT",
    name: "Strategic Agentic Trading",
    priceUsd,
    marketCapUsd: priceUsd * SUPPLY,
    change24hPct: firstPrice ? ((priceUsd - firstPrice) / firstPrice) * 100 : null,
    volume24hUsd: trades.reduce((s, t) => s + t.usd, 0),
    trades24h: trades.length,
    buys24h: trades.filter((t) => t.side === "buy").length,
    recent: trades.slice(-12).reverse(),
    buyUrl: ponsTokenUrl(address),
    explorerUrl: `${cfg.RH_EXPLORER_URL}/token/${address}`,
    updatedAt: Date.now(),
  };
}

export interface SatHolding {
  address: `0x${string}`;
  balance: number;
  valueUsd: number;
  tier: TierId;
  next: { id: TierId; needUsd: number } | null;
}

export function thresholds(cfg = getConfig()): TierThresholds {
  return { holderUsd: cfg.SAT_TIER_HOLDER_USD, whaleUsd: cfg.SAT_TIER_WHALE_USD };
}

export async function satHolding(wallet: `0x${string}`): Promise<SatHolding> {
  const cfg = getConfig();
  return cache.get(`sat:holding:${wallet.toLowerCase()}`, 20_000, async () => {
    const [raw, priceUsd] = await Promise.all([
      getPublicClient().readContract({ address: cfg.SAT_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      satPriceUsd(),
    ]);
    const balance = Number(raw) / 1e18;
    const valueUsd = balance * priceUsd;
    return { address: getAddress(wallet), balance, valueUsd, tier: tierFor(valueUsd, thresholds(cfg)), next: nextTier(valueUsd, thresholds(cfg)) };
  });
}
