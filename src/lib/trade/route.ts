import { concat, encodeFunctionData, getAddress, numberToHex, parseAbi, size } from "viem";
import { getPublicClient } from "../chain/client";
import { FEE_TIERS, QUOTE_ASSETS, UNISWAP_V3 } from "../chain/constants";
import type { TokenMarket } from "../types";

/**
 * Uniswap v3 routing for Stock Tokens. Most stock pools quote in USDG, so a
 * buy paid in ETH goes WETH → USDG → stock, and a sell comes back the same way
 * and is unwrapped to native ETH. Every candidate path is priced by QuoterV2,
 * which simulates the real pools, so the minimum-out is exact rather than
 * estimated from an indexed price.
 */

export interface SwapRoute {
  tokens: `0x${string}`[];
  fees: number[];
  amountIn: bigint;
  amountOut: bigint;
}

/** SwapRouter02 keeps the output itself when the recipient is this sentinel. */
export const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;

const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export const router02Abi = parseAbi([
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export function encodePath(tokens: `0x${string}`[], fees: number[]): `0x${string}` {
  if (tokens.length !== fees.length + 1) throw new Error("Path needs one fee per hop");
  const parts: `0x${string}`[] = [];
  tokens.forEach((t, i) => {
    parts.push(getAddress(t));
    if (i < fees.length) parts.push(numberToHex(fees[i], { size: 3 }));
  });
  const path = concat(parts);
  if (size(path) !== 20 * tokens.length + 3 * fees.length) throw new Error("Bad path encoding");
  return path;
}

function quoteAssetOf(market: TokenMarket) {
  return QUOTE_ASSETS.find((q) => q.symbol === market.quoteSymbol) ?? null;
}

/** Every path worth pricing between the wrapped native asset and this stock. */
export function candidatePaths(market: TokenMarket, side: "buy" | "sell", wrapped: `0x${string}`): { tokens: `0x${string}`[]; fees: number[] }[] {
  const token = getAddress(market.token.address);
  const quote = quoteAssetOf(market);
  const weth = getAddress(wrapped);
  const out: { tokens: `0x${string}`[]; fees: number[] }[] = [];
  if (!quote || getAddress(quote.address) === weth) {
    out.push({ tokens: [weth, token], fees: [market.feeTier] });
  } else {
    const q = getAddress(quote.address);
    for (const f of FEE_TIERS) out.push({ tokens: [weth, q, token], fees: [f, market.feeTier] });
  }
  return side === "buy" ? out : out.map((p) => ({ tokens: [...p.tokens].reverse(), fees: [...p.fees].reverse() }));
}

/** Best priced path for this trade, or null if no pool combination can fill it. */
export async function quoteRoute(
  market: TokenMarket,
  side: "buy" | "sell",
  amountIn: bigint,
  wrapped: `0x${string}`,
  quoter: `0x${string}` = UNISWAP_V3.quoterV2,
): Promise<SwapRoute | null> {
  const client = getPublicClient();
  const paths = candidatePaths(market, side, wrapped);
  const attempt = () =>
    Promise.all(
      paths.map(async (p) => {
        try {
          const { result } = await client.simulateContract({
            address: quoter,
            abi: quoterAbi,
            functionName: "quoteExactInput",
            args: [encodePath(p.tokens, p.fees), amountIn],
          });
          return { route: { ...p, amountIn, amountOut: result[0] } as SwapRoute, transient: false };
        } catch (err) {
          // A revert means that pool combination cannot fill; anything else is the RPC.
          return { route: null, transient: !isRevert(err) };
        }
      }),
    );
  let results = await attempt();
  if (results.every((r) => !r.route) && results.some((r) => r.transient)) results = await attempt();
  const best = results
    .map((r) => r.route)
    .filter((q): q is SwapRoute => q !== null && q.amountOut > 0n)
    .sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))[0];
  if (!best && results.some((r) => r.transient)) throw new Error("Could not reach the chain to quote this trade. Try again in a moment.");
  return best ?? null;
}

function isRevert(err: unknown): boolean {
  const e = err as { name?: string; shortMessage?: string; message?: string; cause?: unknown };
  const text = `${e.name ?? ""} ${e.shortMessage ?? ""} ${e.message ?? ""}`;
  if (/revert/i.test(text)) return true;
  return e.cause ? isRevert(e.cause) : false;
}

/** Calldata for a routed buy paid in native ETH. The router wraps msg.value itself. */
export function encodeRoutedBuy(route: SwapRoute, minOut: bigint, wallet: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: router02Abi,
    functionName: "exactInput",
    args: [{ path: encodePath(route.tokens, route.fees), recipient: wallet, amountIn: route.amountIn, amountOutMinimum: minOut }],
  });
}

/** Calldata for a routed sell whose WETH proceeds are unwrapped to native ETH in the same transaction. */
export function encodeRoutedSell(route: SwapRoute, minOut: bigint, wallet: `0x${string}`): `0x${string}` {
  const swap = encodeFunctionData({
    abi: router02Abi,
    functionName: "exactInput",
    args: [{ path: encodePath(route.tokens, route.fees), recipient: ADDRESS_THIS, amountIn: route.amountIn, amountOutMinimum: minOut }],
  });
  const unwrap = encodeFunctionData({ abi: router02Abi, functionName: "unwrapWETH9", args: [minOut, wallet] });
  return encodeFunctionData({ abi: router02Abi, functionName: "multicall", args: [[swap, unwrap]] });
}
