import { erc20Abi, formatUnits, getAddress, isAddress, parseAbiItem } from "viem";
import { getPublicClient } from "./client";
import type { TokenInfo, TokenMarket } from "../types";

/**
 * Robinhood Chain produces a block roughly every 100ms, so block windows are
 * short in wall-clock terms: 50,000 blocks is about 83 minutes. eth_getLogs
 * comfortably serves 50,000-block spans, which makes a day of history about 18
 * requests for a single contract — fine on demand, but far too many to run
 * across the whole token universe.
 */
const BLOCK_SECONDS = 0.1;
const BLOCKS_PER_HOUR = Math.round(3600 / BLOCK_SECONDS);
const LOG_CHUNK = 50_000n;
const MAX_HOURS = 24;

export async function getTokenInfo(address: string): Promise<TokenInfo> {
  if (!isAddress(address)) throw new Error(`Invalid address: ${address}`);
  const client = getPublicClient();
  const token = getAddress(address);
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address: token, symbol, name, decimals };
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

const ZERO = "0x0000000000000000000000000000000000000000";

export interface FlowEntry {
  address: `0x${string}`;
  netTokens: number;
  netUsd: number;
}

export interface OnchainSnapshot {
  token: TokenInfo;
  window: { hours: number; fromBlock: string; toBlock: string };
  totalSupply: number;
  transferCount: number;
  uniqueWallets: number;
  mintedTokens: number;
  burnedTokens: number;
  /** Swap activity in the token's primary Uniswap pool */
  pool: {
    address: `0x${string}`;
    quoteSymbol: string;
    swapCount: number;
    volumeUsd: number;
    buyVolumeUsd: number;
    sellVolumeUsd: number;
    uniqueTraders: number;
  } | null;
  whaleTransfers: { from: string; to: string; tokens: number; usd: number; pctSupply: number; txHash: string }[];
  topNetAccumulators: FlowEntry[];
  topNetDistributors: FlowEntry[];
}

async function getLogsChunked<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n > toBlock ? toBlock : from + LOG_CHUNK - 1n;
    out.push(...(await fetchRange(from, to)));
  }
  return out;
}

/**
 * Summarise recent on-chain activity for a token: ERC-20 transfer flow plus
 * swap volume from its primary pool. Volume is priced with the current spot
 * price, so it is an approximation for the window rather than a VWAP.
 */
export async function getOnchainSnapshot(
  market: TokenMarket,
  opts: { hours?: number; whaleThresholdPct?: number } = {},
): Promise<OnchainSnapshot> {
  const hours = Math.min(Math.max(opts.hours ?? 6, 0.25), MAX_HOURS);
  const whaleThresholdPct = opts.whaleThresholdPct ?? 0.25;
  const client = getPublicClient();
  const token = market.token;

  const supplyRaw = await client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "totalSupply",
  });
  const totalSupply = Number(formatUnits(supplyRaw, token.decimals));

  const latest = await client.getBlockNumber();
  const span = BigInt(Math.round(hours * BLOCKS_PER_HOUR));
  const start = latest > span ? latest - span : 0n;
  const price = market.priceUsd;

  const transfers = await getLogsChunked(start, latest, (from, to) =>
    client.getLogs({ address: token.address, event: TRANSFER_EVENT, fromBlock: from, toBlock: to }),
  );

  const net = new Map<string, number>();
  const wallets = new Set<string>();
  const whales: OnchainSnapshot["whaleTransfers"] = [];
  let mintedTokens = 0;
  let burnedTokens = 0;

  for (const log of transfers) {
    const { from: src, to: dst, value } = log.args;
    if (!src || !dst || value === undefined) continue;
    const tokens = Number(formatUnits(value, token.decimals));
    const isMint = src.toLowerCase() === ZERO;
    const isBurn = dst.toLowerCase() === ZERO;
    if (isMint) mintedTokens += tokens;
    if (isBurn) burnedTokens += tokens;
    if (!isMint) {
      wallets.add(src);
      net.set(src, (net.get(src) ?? 0) - tokens);
    }
    if (!isBurn) {
      wallets.add(dst);
      net.set(dst, (net.get(dst) ?? 0) + tokens);
    }
    const pct = totalSupply > 0 ? (tokens / totalSupply) * 100 : 0;
    if (pct >= whaleThresholdPct && whales.length < 25) {
      whales.push({
        from: src,
        to: dst,
        tokens,
        usd: tokens * price,
        pctSupply: Number(pct.toFixed(3)),
        txHash: log.transactionHash,
      });
    }
  }

  let pool: OnchainSnapshot["pool"] = null;
  try {
    // Ask the pool which side the Stock Token is on rather than inferring it.
    const token0 = await client.readContract({
      address: market.poolAddress,
      abi: [{ type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
      functionName: "token0",
    });
    const stockIsToken0 = token0.toLowerCase() === token.address.toLowerCase();
    const swaps = await getLogsChunked(start, latest, (from, to) =>
      client.getLogs({ address: market.poolAddress, event: SWAP_EVENT, fromBlock: from, toBlock: to }),
    );
    // amount0/amount1 are signed from the pool's perspective. The Stock Token
    // side tells us direction: negative means the pool paid out, i.e. a buy.
    const traders = new Set<string>();
    let buyVolumeUsd = 0;
    let sellVolumeUsd = 0;
    for (const log of swaps) {
      const { recipient, amount0, amount1 } = log.args;
      if (amount0 === undefined || amount1 === undefined) continue;
      if (recipient) traders.add(recipient);
      const stockAmount = stockIsToken0 ? amount0 : amount1;
      const tokens = Math.abs(Number(formatUnits(stockAmount, token.decimals)));
      const usd = tokens * price;
      if (stockAmount < 0n) buyVolumeUsd += usd;
      else sellVolumeUsd += usd;
    }
    pool = {
      address: market.poolAddress,
      quoteSymbol: market.quoteSymbol,
      swapCount: swaps.length,
      volumeUsd: buyVolumeUsd + sellVolumeUsd,
      buyVolumeUsd,
      sellVolumeUsd,
      uniqueTraders: traders.size,
    };
  } catch {
    pool = null;
  }

  const entries: FlowEntry[] = [...net.entries()]
    .filter(([a]) => a.toLowerCase() !== ZERO && a.toLowerCase() !== market.poolAddress.toLowerCase())
    .map(([address, netTokens]) => ({
      address: address as `0x${string}`,
      netTokens,
      netUsd: netTokens * price,
    }));

  return {
    token,
    window: { hours, fromBlock: start.toString(), toBlock: latest.toString() },
    totalSupply,
    transferCount: transfers.length,
    uniqueWallets: wallets.size,
    mintedTokens,
    burnedTokens,
    pool,
    whaleTransfers: whales.sort((a, b) => b.tokens - a.tokens),
    topNetAccumulators: [...entries].sort((a, b) => b.netTokens - a.netTokens).slice(0, 5),
    topNetDistributors: [...entries].sort((a, b) => a.netTokens - b.netTokens).slice(0, 5),
  };
}

export async function getWalletBalances(wallet: string, tokens: string[] = []) {
  if (!isAddress(wallet)) throw new Error(`Invalid wallet: ${wallet}`);
  const client = getPublicClient();
  const address = getAddress(wallet);
  const native = await client.getBalance({ address });
  const erc20 = await Promise.all(
    tokens.map(async (t) => {
      const info = await getTokenInfo(t);
      const raw = await client.readContract({
        address: info.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      return { token: info, balance: Number(formatUnits(raw, info.decimals)) };
    }),
  );
  return { native: Number(formatUnits(native, 18)), erc20 };
}
