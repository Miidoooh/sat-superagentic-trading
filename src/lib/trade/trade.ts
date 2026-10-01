import { z } from "zod";
import { encodeFunctionData, erc20Abi, getAddress, parseAbi, parseEther, parseUnits } from "viem";
import { executionEnabled, getConfig, type SatConfig } from "../config";
import type { TokenMarket } from "../types";

/**
 * Trade intents are PROPOSALS. SAT never holds keys: the browser wallet must
 * sign every transaction. Server-side code only validates guardrails and
 * encodes calldata.
 */

export const TradeIntentSchema = z.object({
  side: z.enum(["buy", "sell"]),
  /** Token contract address (0x…) */
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** buy: amount of native asset to spend. sell: amount of token to sell. */
  amount: z.number().positive().finite(),
  slippageBps: z.number().int().min(1).max(1000).optional(),
  rationale: z.string().max(600).optional(),
});

export type TradeIntent = z.infer<typeof TradeIntentSchema>;

/** Never risk more than this share of pool liquidity in a single trade */
const MAX_LIQUIDITY_SHARE = 0.02;

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

export interface TxStep {
  label: string;
  to: `0x${string}`;
  data: `0x${string}`;
  /** wei, decimal string */
  value: string;
}

export interface BuiltTrade {
  venue?: "uniswap-v3" | "uniswap-v4" | "pons";
  side: TradeIntent["side"];
  symbol: string;
  tokenAddress: `0x${string}`;
  chainId: number;
  amountIn: string;
  estimatedOut: string;
  minOut: string;
  slippageBps: number;
  notionalUsd: number;
  steps: TxStep[];
  warnings: string[];
  /** Quoted loss versus spot in percent, fees included. Null when unknown. */
  priceImpactPct?: number | null;
  /** True when the output was simulated against live contracts. */
  exact?: boolean;
  /** Only an approval was returned; build again after it confirms to get an exact quote. */
  needsRebuild?: boolean;
  /** SAT trade fee taken from the output, in basis points, and its value in USD. */
  feeBps?: number;
  feeUsd?: number;
}

export const EXECUTION_DISABLED = "Execution is disabled: set SAT_ENABLE_TRADING=true to allow trade building.";

export function validateIntent(
  intent: TradeIntent,
  market: TokenMarket,
  nativeUsd: number,
  cfg: SatConfig = getConfig(),
): string[] {
  const errors: string[] = [];
  if (!executionEnabled(cfg)) {
    errors.push(EXECUTION_DISABLED);
  }
  const slippage = intent.slippageBps ?? cfg.SAT_MAX_SLIPPAGE_BPS;
  if (slippage > cfg.SAT_MAX_SLIPPAGE_BPS) {
    errors.push(`Slippage ${slippage}bps exceeds the ${cfg.SAT_MAX_SLIPPAGE_BPS}bps guardrail.`);
  }
  if (market.liquidityUsd < cfg.SAT_MIN_LIQUIDITY_USD) {
    errors.push(`Pool liquidity $${Math.round(market.liquidityUsd)} is below the $${cfg.SAT_MIN_LIQUIDITY_USD} minimum.`);
  }
  const notionalUsd =
    intent.side === "buy" ? intent.amount * nativeUsd : intent.amount * market.priceUsd;
  if (intent.side === "buy" && intent.amount > cfg.SAT_MAX_TRADE_NATIVE) {
    errors.push(`Buy size ${intent.amount} exceeds the ${cfg.SAT_MAX_TRADE_NATIVE} native-asset guardrail.`);
  }
  if (intent.side === "sell" && notionalUsd > cfg.SAT_MAX_TRADE_NATIVE * nativeUsd) {
    errors.push(`Sell notional $${notionalUsd.toFixed(2)} exceeds the per-trade guardrail.`);
  }
  if (notionalUsd > market.liquidityUsd * MAX_LIQUIDITY_SHARE) {
    errors.push(`Trade is more than ${MAX_LIQUIDITY_SHARE * 100}% of pool liquidity (price impact risk).`);
  }
  return errors;
}

function toUnits(value: number, decimals: number): bigint {
  return parseUnits(value.toFixed(Math.min(decimals, 18)), decimals);
}

/**
 * Encode a swap through a Uniswap-V3 SwapRouter02-compatible router.
 * Buys send native value (router wraps it). Sells return WRAPPED native to the
 * wallet after an exact-amount approval (never unlimited).
 */
export function buildTrade(
  intent: TradeIntent,
  market: TokenMarket,
  nativeUsd: number,
  opts: { wallet: string; currentAllowance?: bigint },
  cfg: SatConfig = getConfig(),
): BuiltTrade {
  const errors = validateIntent(intent, market, nativeUsd, cfg);
  if (errors.length) throw new Error(errors.join(" "));

  const router = cfg.RH_SWAP_ROUTER!;
  const wrapped = cfg.RH_WRAPPED_NATIVE!;
  const wallet = getAddress(opts.wallet);
  const token = getAddress(intent.token);
  if (token.toLowerCase() !== market.token.address.toLowerCase()) throw new Error("Token does not match resolved market.");

  const slippage = intent.slippageBps ?? cfg.SAT_MAX_SLIPPAGE_BPS;
  const feeFactor = 1 - market.feeTier / 1_000_000;
  const slipFactor = 1 - slippage / 10_000;
  const warnings = [
    "Estimated output uses the indexed pool price; actual execution price may differ.",
  ];
  const steps: TxStep[] = [];
  const notionalUsd = intent.side === "buy" ? intent.amount * nativeUsd : intent.amount * market.priceUsd;

  if (intent.side === "buy") {
    const amountIn = parseEther(intent.amount.toFixed(18));
    const expectedTokens = ((intent.amount * nativeUsd) / market.priceUsd) * feeFactor;
    const minOut = toUnits(expectedTokens * slipFactor, market.token.decimals);
    steps.push({
      label: `Swap ${intent.amount} ${cfg.RH_NATIVE_SYMBOL} for ${market.token.symbol}`,
      to: router,
      value: amountIn.toString(),
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: wrapped,
          tokenOut: token,
          fee: market.feeTier,
          recipient: wallet,
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        }],
      }),
    });
    return {
      side: "buy",
      symbol: market.token.symbol,
      tokenAddress: token,
      chainId: cfg.RH_CHAIN_ID,
      amountIn: `${intent.amount} ${cfg.RH_NATIVE_SYMBOL}`,
      estimatedOut: `${expectedTokens.toPrecision(6)} ${market.token.symbol}`,
      minOut: `${(expectedTokens * slipFactor).toPrecision(6)} ${market.token.symbol}`,
      slippageBps: slippage,
      notionalUsd,
      steps,
      warnings,
    };
  }

  const amountIn = toUnits(intent.amount, market.token.decimals);
  const expectedNative = ((intent.amount * market.priceUsd) / nativeUsd) * feeFactor;
  const minOut = toUnits(expectedNative * slipFactor, 18);
  if ((opts.currentAllowance ?? 0n) < amountIn) {
    steps.push({
      label: `Approve exactly ${intent.amount} ${market.token.symbol} for the router`,
      to: token,
      value: "0",
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, amountIn] }),
    });
  }
  steps.push({
    label: `Swap ${intent.amount} ${market.token.symbol} for wrapped ${cfg.RH_NATIVE_SYMBOL}`,
    to: router,
    value: "0",
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{
        tokenIn: token,
        tokenOut: wrapped,
        fee: market.feeTier,
        recipient: wallet,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }],
    }),
  });
  warnings.push(`Proceeds are received as wrapped ${cfg.RH_NATIVE_SYMBOL}.`);
  return {
    side: "sell",
    symbol: market.token.symbol,
    tokenAddress: token,
    chainId: cfg.RH_CHAIN_ID,
    amountIn: `${intent.amount} ${market.token.symbol}`,
    estimatedOut: `${expectedNative.toPrecision(6)} W${cfg.RH_NATIVE_SYMBOL}`,
    minOut: `${(expectedNative * slipFactor).toPrecision(6)} W${cfg.RH_NATIVE_SYMBOL}`,
    slippageBps: slippage,
    notionalUsd,
    steps,
    warnings,
  };
}
