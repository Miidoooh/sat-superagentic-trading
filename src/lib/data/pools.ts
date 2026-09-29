import { erc20Abi, getAddress, parseAbi } from "viem";
import { FEE_TIERS, QUOTE_ASSETS, UNISWAP_V3, type QuoteAsset } from "../chain/constants";
import { getPublicClient } from "../chain/client";
import { cache } from "../cache";
import type { StockAsset } from "./assets";

const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

/**
 * A pool can be created and never seeded. Those sit pinned at an extreme tick
 * and report prices around 1e56, so anything outside this band is discarded
 * rather than shown as a market.
 */
const MIN_PLAUSIBLE_PRICE = 1e-9;
const MAX_PLAUSIBLE_PRICE = 1e9;
/** Below this, a side of the pool is dust rather than real depth. */
const MIN_SIDE_BALANCE_USD = 1;

export interface PoolRef {
  pool: `0x${string}`;
  token: `0x${string}`;
  tokenDecimals: number;
  quote: QuoteAsset;
  feeTier: number;
  /** True when the Stock Token sorts first in the pool's token ordering */
  tokenIsToken0: boolean;
}

export interface PoolState extends PoolRef {
  /** Quote units per one Stock Token */
  priceInQuote: number;
  tokenBalance: number;
  quoteBalance: number;
  /** Active in-range liquidity; zero means the pool was never seeded */
  liquidity: bigint;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const POOL_TTL = 6 * 60 * 60 * 1000;
const STATE_TTL = 20 * 1000;
/** Uniswap orders pool tokens by address, so we can predict which side is which. */
const sortsFirst = (a: string, b: string) => a.toLowerCase() < b.toLowerCase();

/**
 * Discover every Uniswap v3 pool pairing a Stock Token with a known quote
 * asset. Cached for hours because pool creation is rare, and batched through
 * Multicall3 so the whole universe costs a handful of RPC round trips.
 */
export async function discoverPools(assets: StockAsset[]): Promise<Map<string, PoolRef[]>> {
  const key = `pools:${assets.length}:${assets[0]?.address ?? ""}`;
  return cache.get(key, POOL_TTL, async () => {
    const client = getPublicClient();
    const probes: { asset: StockAsset; quote: QuoteAsset; fee: number }[] = [];
    for (const asset of assets) {
      for (const quote of QUOTE_ASSETS) {
        if (asset.address.toLowerCase() === quote.address.toLowerCase()) continue;
        for (const fee of FEE_TIERS) probes.push({ asset, quote, fee });
      }
    }

    const byToken = new Map<string, PoolRef[]>();
    const CHUNK = 400;
    for (let i = 0; i < probes.length; i += CHUNK) {
      const slice = probes.slice(i, i + CHUNK);
      const results = await client.multicall({
        contracts: slice.map((p) => ({
          address: getAddress(UNISWAP_V3.factory),
          abi: factoryAbi,
          functionName: "getPool" as const,
          args: [p.asset.address, getAddress(p.quote.address), p.fee] as const,
        })),
        allowFailure: true,
      });
      results.forEach((r, j) => {
        if (r.status !== "success") return;
        const pool = r.result as `0x${string}`;
        if (!pool || pool.toLowerCase() === ZERO) return;
        const { asset, quote, fee } = slice[j];
        const list = byToken.get(asset.address) ?? [];
        list.push({
          pool: getAddress(pool),
          token: asset.address,
          tokenDecimals: asset.decimals,
          quote,
          feeTier: fee,
          tokenIsToken0: sortsFirst(asset.address, quote.address),
        });
        byToken.set(asset.address, list);
      });
    }
    return byToken;
  });
}

/**
 * Read spot price and both token balances for each pool. Balances give a real
 * TVL figure, which is what we use to pick a token's primary pool.
 */
export async function readPoolStates(refs: PoolRef[]): Promise<PoolState[]> {
  if (refs.length === 0) return [];
  const key = `poolstate:${refs.length}:${refs[0].pool}:${refs[refs.length - 1].pool}`;
  return cache.get(key, STATE_TTL, async () => {
    const client = getPublicClient();
    const out: PoolState[] = [];
    const CHUNK = 120;
    for (let i = 0; i < refs.length; i += CHUNK) {
      const slice = refs.slice(i, i + CHUNK);
      const PER_POOL = 4;
      const contracts = slice.flatMap((r) => [
        { address: r.pool, abi: poolAbi, functionName: "slot0" as const },
        { address: r.pool, abi: poolAbi, functionName: "liquidity" as const },
        { address: r.token, abi: erc20Abi, functionName: "balanceOf" as const, args: [r.pool] as const },
        { address: getAddress(r.quote.address), abi: erc20Abi, functionName: "balanceOf" as const, args: [r.pool] as const },
      ]);
      const results = await client.multicall({ contracts, allowFailure: true });
      slice.forEach((ref, j) => {
        const [slot0, liq, tokenBal, quoteBal] = results.slice(j * PER_POOL, j * PER_POOL + PER_POOL);
        if (
          slot0.status !== "success" ||
          liq.status !== "success" ||
          tokenBal.status !== "success" ||
          quoteBal.status !== "success"
        ) {
          return;
        }
        const liquidity = liq.result as bigint;
        if (liquidity <= 0n) return;

        const sqrtPriceX96 = (slot0.result as readonly [bigint, number, number, number, number, number, boolean])[0];
        if (sqrtPriceX96 <= 0n) return;
        const priceInQuote = sqrtToPrice(sqrtPriceX96, ref);
        if (
          !Number.isFinite(priceInQuote) ||
          priceInQuote < MIN_PLAUSIBLE_PRICE ||
          priceInQuote > MAX_PLAUSIBLE_PRICE
        ) {
          return;
        }

        const tokenBalance = Number(tokenBal.result as bigint) / 10 ** ref.tokenDecimals;
        const quoteBalance = Number(quoteBal.result as bigint) / 10 ** ref.quote.decimals;
        // Both sides must hold something, or the "price" is an artefact.
        if (tokenBalance * priceInQuote < MIN_SIDE_BALANCE_USD || quoteBalance <= 0) return;

        out.push({ ...ref, priceInQuote, tokenBalance, quoteBalance, liquidity });
      });
    }
    return out;
  });
}

/**
 * Convert Uniswap's sqrtPriceX96 into quote units per whole Stock Token.
 * slot0 prices token1 in terms of token0, both in raw units, so the result has
 * to be rescaled by the two tokens' decimals and flipped when the Stock Token
 * is token1.
 */
export function sqrtToPrice(sqrtPriceX96: bigint, ref: PoolRef): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const token1PerToken0 = ratio * ratio;
  const d0 = ref.tokenIsToken0 ? ref.tokenDecimals : ref.quote.decimals;
  const d1 = ref.tokenIsToken0 ? ref.quote.decimals : ref.tokenDecimals;
  const scaled = token1PerToken0 * 10 ** (d0 - d1);
  return ref.tokenIsToken0 ? scaled : 1 / scaled;
}
