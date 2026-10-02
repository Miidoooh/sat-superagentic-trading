import { encodeFunctionData, formatEther, formatUnits, getAddress, parseAbi, parseEther } from "viem";
import { getPublicClient } from "../chain/client";
import { USDG, V4_POOL_MANAGER, WRAPPED_NATIVE } from "../chain/constants";
import { SAT_POOL_KEY } from "../sat/token";

/**
 * Buying and selling SAT. SAT graduated into a Uniswap v4 pool against USDG
 * with a Pons hook, and wallets reach it through the public Pons swap router
 * (the one pons.family itself uses). A buy routes ETH → USDG on Uniswap v3 and
 * USDG → SAT on v4 in one transaction; a sell runs the same path backwards and
 * pays out native ETH. The router charges 1% and the hook keeps its tax.
 *
 * The router returns nothing, so quotes come from eth_simulateV1: the exact
 * transaction is run against live state and the amount that lands in the
 * wallet is read from its transfers.
 */

/** Upgradeable proxy (EIP-1967). Verified from 220+ SAT swaps by many wallets. */
export const PONS_SWAP_ROUTER = "0x65050A9b7E5075A2bA5cED7b1b64EE66262c40Dc" as const;
/** Uniswap v3 WETH/USDG pool, 0.01% fee: the first hop of every SAT trade. */
const WETH_USDG_V3 = "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca" as const;
/** A wallet with a large SAT balance, used to preview sells before a wallet connects. */
const PREVIEW_HOLDER = "0x540133E677346E57FFA8D100faB0179a08C7f0A4" as const;
const PREVIEW_BUYER = "0x1111111111111111111111111111111111111111" as const;
const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = `0x${"0".repeat(64)}` as const;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ROUTER_FEE_BPS = 100;

export const satRouterAbi = parseAbi([
  "function swap((uint8 kind, address tokenIn, address tokenOut, address pool, uint24 fee, int24 tickSpacing, address hooks, bytes hookData, address poolManager, bytes32 poolId)[] route, address recipient, uint256 amountIn, uint256 minOut, uint256 deadline) payable",
]);
const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

type Hop = {
  kind: number;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  pool: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
  hookData: `0x${string}`;
  poolManager: `0x${string}`;
  poolId: `0x${string}`;
};

const v3Hop = (tokenIn: `0x${string}`, tokenOut: `0x${string}`): Hop => ({
  kind: 1,
  tokenIn,
  tokenOut,
  pool: WETH_USDG_V3,
  fee: 100,
  tickSpacing: 1,
  hooks: ZERO,
  hookData: "0x",
  poolManager: ZERO,
  poolId: ZERO32,
});

const v4Hop = (tokenIn: `0x${string}`, tokenOut: `0x${string}`): Hop => ({
  kind: 2,
  tokenIn,
  tokenOut,
  pool: ZERO,
  fee: SAT_POOL_KEY.fee,
  tickSpacing: SAT_POOL_KEY.tickSpacing,
  hooks: getAddress(SAT_POOL_KEY.hooks),
  hookData: "0x",
  poolManager: V4_POOL_MANAGER,
  poolId: ZERO32,
});

/** A graduated launch's v4 pool, enough to route through it. */
export interface V4Target {
  token: `0x${string}`;
  /** The launch's pair asset: the zero address for native ETH, or an ERC-20 such as USDG. */
  pairToken: `0x${string}`;
  pool: { fee: number; tickSpacing: number; hooks: `0x${string}` };
}

export const SAT_TARGET: V4Target = {
  token: getAddress(SAT_POOL_KEY.currency1),
  pairToken: getAddress(USDG.address),
  pool: { fee: SAT_POOL_KEY.fee, tickSpacing: SAT_POOL_KEY.tickSpacing, hooks: getAddress(SAT_POOL_KEY.hooks) },
};

const v4HopFor = (t: V4Target, tokenIn: `0x${string}`, tokenOut: `0x${string}`): Hop => ({
  ...v4Hop(tokenIn, tokenOut),
  fee: t.pool.fee,
  tickSpacing: t.pool.tickSpacing,
  hooks: getAddress(t.pool.hooks),
});

/**
 * The route for a graduated launch, or null when its pair asset cannot be
 * reached from ETH. Native-ETH pools take one v4 hop with ETH sent along
 * (verified by simulation); USDG pools go through the v3 WETH/USDG pool first.
 */
export function routeFor(t: V4Target, side: "buy" | "sell"): Hop[] | null {
  const token = getAddress(t.token);
  if (t.pairToken.toLowerCase() === ZERO) return side === "buy" ? [v4HopFor(t, ZERO, token)] : [v4HopFor(t, token, ZERO)];
  if (t.pairToken.toLowerCase() === USDG.address.toLowerCase()) {
    const weth = getAddress(WRAPPED_NATIVE);
    const usdg = getAddress(USDG.address);
    return side === "buy" ? [v3Hop(weth, usdg), v4HopFor(t, usdg, token)] : [v4HopFor(t, token, usdg), v3Hop(usdg, weth)];
  }
  return null;
}

export function satRoute(side: "buy" | "sell"): Hop[] {
  return routeFor(SAT_TARGET, side)!;
}

/** Calldata for one trade. The recipient is the signer (address zero tells the router "msg.sender"). */
export function encodeV4Swap(t: V4Target, side: "buy" | "sell", amountIn: bigint, minOut: bigint): `0x${string}` {
  const route = routeFor(t, side);
  if (!route) throw new Error("This token's pool pairs with an asset SAT cannot route to yet.");
  return encodeFunctionData({ abi: satRouterAbi, functionName: "swap", args: [route, ZERO, amountIn, minOut, 0n] });
}

export function encodeSatSwap(side: "buy" | "sell", amountIn: bigint, minOut: bigint): `0x${string}` {
  return encodeV4Swap(SAT_TARGET, side, amountIn, minOut);
}

export function satApproveData(amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: erc20, functionName: "approve", args: [PONS_SWAP_ROUTER, amount] });
}

interface SimLog {
  address: string;
  topics: string[];
  data: string;
}
interface SimCall {
  status: string;
  error?: { message?: string };
  logs: SimLog[];
}

/** What the trader receives, read from the simulated transfers to them. */
function receivedFrom(logs: SimLog[], side: "buy" | "sell", trader: string, token: string): bigint {
  const who = trader.toLowerCase();
  let total = 0n;
  for (const l of logs) {
    if (l.topics[0] !== TRANSFER_TOPIC || `0x${(l.topics[2] ?? "").slice(26)}`.toLowerCase() !== who) continue;
    const isToken = l.address.toLowerCase() === token.toLowerCase();
    const isEth = l.address.toLowerCase() === NATIVE_SENTINEL;
    if ((side === "buy" && isToken) || (side === "sell" && isEth)) total += BigInt(l.data);
  }
  return total;
}

export interface SatQuote {
  amountOut: bigint;
  /** True when simulated from the trader's own wallet. */
  fromWallet: boolean;
}

/**
 * Simulate the real trade against live state. A sell includes its exact
 * approval in the same simulated block, so it quotes before the user approves.
 * Without a wallet, sells are previewed from a known holder of the token.
 */
export async function quoteV4Swap(
  t: V4Target,
  side: "buy" | "sell",
  amountIn: bigint,
  wallet: `0x${string}` | null,
  previewHolder: `0x${string}` = PREVIEW_HOLDER,
): Promise<SatQuote> {
  const trader = wallet ?? (side === "buy" ? PREVIEW_BUYER : previewHolder);
  const swapCall = {
    from: trader,
    to: PONS_SWAP_ROUTER,
    data: encodeV4Swap(t, side, amountIn, 0n),
    ...(side === "buy" ? { value: `0x${amountIn.toString(16)}` } : {}),
  };
  const approve = { from: trader, to: getAddress(t.token), data: satApproveData(amountIn) };
  const calls = side === "buy" ? [swapCall] : [approve, swapCall];
  // Previews top up gas money; a real wallet's buy is checked against its own balance first.
  const overrides = { [trader]: { balance: `0x${(parseEther("1000") + (side === "buy" ? amountIn : 0n)).toString(16)}` } };
  const result = (await getPublicClient().request({
    method: "eth_simulateV1",
    params: [{ blockStateCalls: [{ stateOverrides: overrides, calls }], validation: false, traceTransfers: true }, "latest"],
  } as never)) as { calls: SimCall[] }[];
  const swap = result[0]?.calls[calls.length - 1];
  if (!swap) throw new Error("Could not simulate this trade.");
  if (swap.status !== "0x1") {
    const reason = swap.error?.message ?? "the router rejected it";
    throw new Error(side === "sell" && !wallet ? `Connect a wallet to quote this sell exactly (${reason}).` : `Trade would fail: ${reason}`);
  }
  const amountOut = receivedFrom(swap.logs, side, trader, t.token);
  if (amountOut <= 0n) throw new Error("The pool returned nothing for this amount.");
  return { amountOut, fromWallet: wallet !== null };
}

export const quoteSatSwap = (side: "buy" | "sell", amountIn: bigint, wallet: `0x${string}` | null) => quoteV4Swap(SAT_TARGET, side, amountIn, wallet);

export async function routerAllowance(token: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
  return getPublicClient().readContract({ address: getAddress(token), abi: erc20, functionName: "allowance", args: [owner, PONS_SWAP_ROUTER] });
}

export async function tokenBalance(token: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
  return getPublicClient().readContract({ address: getAddress(token), abi: erc20, functionName: "balanceOf", args: [owner] });
}

/**
 * A wallet that holds at least `minBalance` of the token, found among recent
 * recipients, so a sell can be previewed before the user connects.
 */
export async function findHolder(token: `0x${string}`, minBalance: bigint): Promise<`0x${string}` | null> {
  const client = getPublicClient();
  const latest = await client.getBlockNumber();
  const logs = await client.getLogs({
    address: getAddress(token),
    event: { type: "event", name: "Transfer", inputs: [{ type: "address", name: "from", indexed: true }, { type: "address", name: "to", indexed: true }, { type: "uint256", name: "value" }] },
    fromBlock: latest > 200_000n ? latest - 200_000n : 0n,
    toBlock: latest,
  });
  const skip = new Set([ZERO, V4_POOL_MANAGER.toLowerCase(), PONS_SWAP_ROUTER.toLowerCase()]);
  const seen = new Set<string>();
  const candidates: `0x${string}`[] = [];
  for (const l of logs.reverse()) {
    const to = l.args.to?.toLowerCase();
    if (!to || skip.has(to) || seen.has(to)) continue;
    seen.add(to);
    candidates.push(getAddress(to));
    if (candidates.length >= 25) break;
  }
  if (!candidates.length) return null;
  const balances = await client.multicall({
    contracts: candidates.map((c) => ({ address: getAddress(token), abi: erc20, functionName: "balanceOf" as const, args: [c] as const })),
    allowFailure: true,
  });
  const i = balances.findIndex((b) => b.status === "success" && (b.result as bigint) >= minBalance);
  return i >= 0 ? candidates[i] : null;
}

export const satAllowance = (owner: `0x${string}`) => routerAllowance(SAT_TARGET.token, owner);
export const satBalance = (owner: `0x${string}`) => tokenBalance(SAT_TARGET.token, owner);

export const fmtTokens = (v: bigint, symbol: string) => `${Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
export const fmtSat = (v: bigint) => fmtTokens(v, "SAT");
export const fmtEth = (v: bigint, symbol = "ETH") => `${Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;