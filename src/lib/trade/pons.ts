import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, getAddress, parseAbi, parseEther, parseUnits } from "viem";
import { getPublicClient } from "../chain/client";
import type { QuoteInfo } from "../data/pons";

/**
 * Pons bonding-curve trades. Each launch is its own curve contract with
 * buy(quoteIn, minTokensOut, recipient) and sell(tokensIn, minQuoteOut,
 * recipient), confirmed from live mainnet transactions. Native-ETH curves take
 * the quote as msg.value; ERC-20 curves (USDG and others) pull it after an
 * approval. The output is read by simulating the call from the user's own
 * wallet, so it already includes the 1% curve fee and any launch tax.
 */

export const curveTradeAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";
/** Stand-in account for previews before a wallet is connected. */
export const PREVIEW_ACCOUNT = "0x000000000000000000000000000000000000dEaD" as const;
export const CURVE_FEE = 0.01;

export const isNativePair = (pairToken: string) => pairToken.toLowerCase() === ZERO;

export interface CurveQuote {
  amountIn: bigint;
  amountOut: bigint;
  /** Output at the current spot price with no fee, tax or curve slippage. */
  spotOut: bigint;
  /** True when the output came from a simulation rather than the reserve formula. */
  exact: boolean;
}

/** Constant-product output after the 1% fee. Used when a simulation is not possible. */
export function curveFormulaOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const net = (amountIn * 99n) / 100n;
  return (reserveOut * net) / (reserveIn + net);
}

export function spotOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return reserveIn > 0n ? (amountIn * reserveOut) / reserveIn : 0n;
}

/** Share of value lost against spot, as a percentage. */
export function impactPct(out: bigint, spot: bigint): number {
  if (spot <= 0n) return 0;
  return Math.max(0, (1 - Number((out * 1_000_000n) / spot) / 1_000_000) * 100);
}

/**
 * Price a curve trade. Reverts from getReserves mean the launch graduated to
 * Uniswap and no longer trades on its curve.
 */
export async function quoteCurve(
  curve: `0x${string}`,
  side: "buy" | "sell",
  amountIn: bigint,
  opts: { account: `0x${string}`; nativePair: boolean; canSimulate: boolean },
): Promise<CurveQuote> {
  const client = getPublicClient();
  let reserves: readonly [bigint, bigint];
  try {
    reserves = await client.readContract({ address: curve, abi: curveTradeAbi, functionName: "getReserves" });
  } catch {
    throw new Error("This launch has graduated from its Pons curve and now trades on Uniswap.");
  }
  const [quoteReserve, tokenReserve] = reserves;
  const [rIn, rOut] = side === "buy" ? [quoteReserve, tokenReserve] : [tokenReserve, quoteReserve];
  const spot = spotOut(amountIn, rIn, rOut);

  if (opts.canSimulate) {
    const data =
      side === "buy"
        ? encodeFunctionData({ abi: curveTradeAbi, functionName: "buy", args: [amountIn, 0n, opts.account] })
        : encodeFunctionData({ abi: curveTradeAbi, functionName: "sell", args: [amountIn, 0n, opts.account] });
    const value = side === "buy" && opts.nativePair ? amountIn : 0n;
    // A preview account gets enough ETH to cover a native buy; real wallets use their own balance.
    const stateOverride =
      opts.account === PREVIEW_ACCOUNT && value > 0n ? [{ address: opts.account, balance: value + parseEther("1") }] : undefined;
    try {
      const res = await client.call({ account: opts.account, to: curve, data, value, stateOverride });
      if (res.data) {
        const out = decodeFunctionResult({ abi: curveTradeAbi, functionName: side, data: res.data });
        return { amountIn, amountOut: out, spotOut: spot, exact: true };
      }
    } catch (err) {
      const reason = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
      throw new Error(`The curve rejected this trade in simulation: ${reason.split("\n")[0]}`);
    }
  }
  return { amountIn, amountOut: curveFormulaOut(amountIn, rIn, rOut), spotOut: spot, exact: false };
}

export async function allowanceOf(token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`): Promise<bigint> {
  return getPublicClient().readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

export async function balanceOf(token: `0x${string}` | null, owner: `0x${string}`): Promise<bigint> {
  const client = getPublicClient();
  if (!token) return client.getBalance({ address: owner });
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export function curveBuyData(amountIn: bigint, minOut: bigint, wallet: `0x${string}`): `0x${string}` {
  return encodeFunctionData({ abi: curveTradeAbi, functionName: "buy", args: [amountIn, minOut, getAddress(wallet)] });
}

export function curveSellData(amountIn: bigint, minOut: bigint, wallet: `0x${string}`): `0x${string}` {
  return encodeFunctionData({ abi: curveTradeAbi, functionName: "sell", args: [amountIn, minOut, getAddress(wallet)] });
}

export function approveData(spender: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

export function unitsOf(amount: number, decimals: number): bigint {
  return parseUnits(amount.toFixed(Math.min(decimals, 18)), decimals);
}

export function fmtUnits(value: bigint, decimals: number, symbol: string): string {
  const n = Number(formatUnits(value, decimals));
  const shown = n === 0 ? "0" : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toPrecision(4);
  return `${shown} ${symbol}`;
}

export type { QuoteInfo };
