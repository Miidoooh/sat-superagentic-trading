import { decodeEventLog, formatUnits, parseAbiItem } from "viem";
import { cache } from "../cache";
import { getPublicClient } from "./client";

const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

const BLOCK_SECONDS = 0.1;
const BLOCKS_PER_HOUR = Math.round(3600 / BLOCK_SECONDS);
const LOG_CHUNK = 50_000n;
const VOLUME_TTL = 6 * 60 * 1000;
const POOL_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export interface PoolVolumeSpec {
  pool: `0x${string}`;
  token: `0x${string}`;
  decimals: number;
  priceUsd: number;
}

export interface PoolVolume24h {
  volumeUsd: number;
  swapCount: number;
}

/**
 * Approximate 24h swap notional per pool from Swap logs. Pools are batched into
 * one eth_getLogs per block slice so the whole stock universe stays within a
 * handful of RPC round trips.
 */
export async function getPoolVolumes24h(specs: PoolVolumeSpec[]): Promise<Map<string, PoolVolume24h>> {
  if (specs.length === 0) return new Map();
  const poolsKey = specs
    .map((s) => s.pool.toLowerCase())
    .sort()
    .join(",");
  return cache.get(`rh:pool-vol24:${poolsKey}`, VOLUME_TTL, () => readVolumes(specs));
}

async function readVolumes(specs: PoolVolumeSpec[]): Promise<Map<string, PoolVolume24h>> {
  const client = getPublicClient();
  const latest = await client.getBlockNumber();
  const span = BigInt(24 * BLOCKS_PER_HOUR);
  const fromBlock = latest > span ? latest - span : 0n;

  const token0 = await client.multicall({
    contracts: specs.map((s) => ({ address: s.pool, abi: POOL_ABI, functionName: "token0" as const })),
    allowFailure: true,
  });

  const meta = new Map<string, { stockIsToken0: boolean; decimals: number; priceUsd: number }>();
  specs.forEach((s, i) => {
    const t0 = token0[i];
    if (t0.status !== "success") return;
    meta.set(s.pool.toLowerCase(), {
      stockIsToken0: t0.result.toLowerCase() === s.token.toLowerCase(),
      decimals: s.decimals,
      priceUsd: s.priceUsd,
    });
  });

  const out = new Map<string, PoolVolume24h>();
  const addresses = specs.map((s) => s.pool);

  for (let from = fromBlock; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
    let chunkLogs: Awaited<ReturnType<typeof client.getLogs>> = [];
    try {
      chunkLogs = await client.getLogs({
        address: addresses,
        event: SWAP_EVENT,
        fromBlock: from,
        toBlock: to,
      });
    } catch {
      // If the node rejects the batch, walk pools in smaller groups for this slice.
      for (let i = 0; i < addresses.length; i += 12) {
        const slice = addresses.slice(i, i + 12);
        try {
          const part = await client.getLogs({
            address: slice,
            event: SWAP_EVENT,
            fromBlock: from,
            toBlock: to,
          });
          chunkLogs = [...chunkLogs, ...part];
        } catch {
          /* skip slice */
        }
      }
    }

    for (const log of chunkLogs) {
      const poolKey = log.address.toLowerCase();
      const m = meta.get(poolKey);
      if (!m) continue;
      let amount0: bigint | undefined;
      let amount1: bigint | undefined;
      try {
        const decoded = decodeEventLog({ abi: [SWAP_EVENT], data: log.data, topics: log.topics });
        if (decoded.eventName !== "Swap") continue;
        amount0 = decoded.args.amount0;
        amount1 = decoded.args.amount1;
      } catch {
        continue;
      }
      if (amount0 === undefined || amount1 === undefined) continue;
      const stockAmount = m.stockIsToken0 ? amount0 : amount1;
      const tokens = Math.abs(Number(formatUnits(stockAmount, m.decimals)));
      const usd = tokens * m.priceUsd;
      if (!Number.isFinite(usd) || usd <= 0) continue;
      const prev = out.get(poolKey) ?? { volumeUsd: 0, swapCount: 0 };
      prev.volumeUsd += usd;
      prev.swapCount += 1;
      out.set(poolKey, prev);
    }
  }

  return out;
}
