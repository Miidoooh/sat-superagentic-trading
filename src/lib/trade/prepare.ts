import { formatUnits, getAddress, parseEther } from "viem";
import { executionEnabled, getConfig, tradeFeeBps, type SatConfig } from "../config";
import { findLaunch, quoteOf } from "../data/pons";
import { getProvider } from "../data/provider";
import { RobinhoodChainProvider } from "../data/robinhood";
import type { TokenMarket } from "../types";
import {
  allowanceOf,
  approveData,
  balanceOf,
  curveBuyData,
  curveSellData,
  fmtUnits,
  impactPct,
  isNativePair,
  PREVIEW_ACCOUNT,
  quoteCurve,
  unitsOf,
} from "./pons";
import { encodeRoutedBuy, encodeRoutedSell, netOfFee, quoteRoute, type RouteFee } from "./route";
import { encodeSatSwap, fmtEth, fmtSat, PONS_SWAP_ROUTER, quoteSatSwap, ROUTER_FEE_BPS, satAllowance, satApproveData, satBalance } from "./sat";
import { EXECUTION_DISABLED, validateIntent, type BuiltTrade, type TradeIntent, type TxStep } from "./trade";

/** Above this, the preview carries a visible price-impact warning. */
const IMPACT_WARN_PCT = 3;

export interface Prepared {
  trade: BuiltTrade | null;
  errors: string[];
  market: TokenMarket | null;
}

interface PrepareOptions {
  /** The signer. Null for a preview before a wallet is connected. */
  wallet: `0x${string}` | null;
  /** Building calldata to sign needs trading enabled; a preview does not. */
  requireExecution: boolean;
}

const minOutOf = (out: bigint, slippageBps: number) => (out * BigInt(10_000 - slippageBps)) / 10_000n;

/** Resolve, guard, quote and (with a wallet) encode a trade on whichever venue the token trades on. */
export async function prepareTrade(intent: TradeIntent, opts: PrepareOptions, cfg: SatConfig = getConfig()): Promise<Prepared> {
  const provider = getProvider();
  if (!provider.capabilities.liveTrading) {
    return { trade: null, market: null, errors: [`Trades are disabled for the ${provider.source} data source.`] };
  }
  const market = await provider.findToken(intent.token);
  if (!market) return { trade: null, market: null, errors: ["Token not found."] };
  if (opts.requireExecution && !executionEnabled(cfg)) return { trade: null, market, errors: [EXECUTION_DISABLED] };

  try {
    const nativeUsd = await provider.nativeUsd();
    const isSat = market.token.address.toLowerCase() === cfg.SAT_TOKEN_ADDRESS.toLowerCase();
    if (market.graduated && !isSat) {
      return { trade: null, market, errors: ["This launch graduated to Uniswap v4. SAT can trade it soon; for now use Pons."] };
    }
    const trade = isSat
      ? await prepareSat(intent, market, nativeUsd, opts, cfg)
      : market.venue === "pons"
        ? await preparePons(intent, market, nativeUsd, opts, cfg, provider)
        : await prepareStock(intent, market, nativeUsd, opts, cfg);
    return trade;
  } catch (err) {
    return { trade: null, market, errors: [(err as Error).message] };
  }
}

async function prepareStock(
  intent: TradeIntent,
  market: TokenMarket,
  nativeUsd: number,
  opts: PrepareOptions,
  cfg: SatConfig,
): Promise<Prepared> {
  const errors = validateIntent(intent, market, nativeUsd, cfg).filter((e) => e !== EXECUTION_DISABLED);
  if (errors.length) return { trade: null, market, errors };

  const router = cfg.RH_SWAP_ROUTER!;
  const wrapped = cfg.RH_WRAPPED_NATIVE!;
  const token = getAddress(market.token.address);
  const slippage = intent.slippageBps ?? cfg.SAT_MAX_SLIPPAGE_BPS;
  const amountIn = intent.side === "buy" ? parseEther(intent.amount.toFixed(18)) : unitsOf(intent.amount, market.token.decimals);

  const steps: TxStep[] = [];
  if (opts.wallet) {
    const balance = await balanceOf(intent.side === "buy" ? null : token, opts.wallet);
    if (balance < amountIn) {
      const have = intent.side === "buy" ? fmtUnits(balance, 18, cfg.RH_NATIVE_SYMBOL) : fmtUnits(balance, market.token.decimals, market.token.symbol);
      return { trade: null, market, errors: [`Not enough balance: this wallet holds ${have}.`] };
    }
    if (intent.side === "sell" && (await allowanceOf(token, opts.wallet, router)) < amountIn) {
      steps.push({
        label: `Approve exactly ${intent.amount} ${market.token.symbol} for the Uniswap router`,
        to: token,
        value: "0",
        data: approveData(router, amountIn),
      });
    }
  }

  const route = await quoteRoute(market, intent.side, amountIn, wrapped);
  if (!route) return { trade: null, market, errors: ["No Uniswap route can fill this trade right now."] };
  const minOut = minOutOf(route.amountOut, slippage);
  const feeBps = tradeFeeBps(cfg);
  const fee: RouteFee | null = feeBps > 0 && cfg.SAT_FEE_RECIPIENT ? { bips: feeBps, recipient: cfg.SAT_FEE_RECIPIENT } : null;

  const outDecimals = intent.side === "buy" ? market.token.decimals : 18;
  const outSymbol = intent.side === "buy" ? market.token.symbol : cfg.RH_NATIVE_SYMBOL;
  // Price impact measures the pools; the SAT fee is shown on its own line.
  const out = Number(formatUnits(route.amountOut, outDecimals));
  const inUsd = intent.side === "buy" ? intent.amount * nativeUsd : intent.amount * market.priceUsd;
  const outUsd = intent.side === "buy" ? out * market.priceUsd : out * nativeUsd;
  const impact = inUsd > 0 ? Math.max(0, (1 - outUsd / inUsd) * 100) : null;
  if (impact !== null && impact > cfg.SAT_MAX_PRICE_IMPACT_PCT) {
    return { trade: null, market, errors: [`Price impact ${impact.toFixed(1)}% is above the ${cfg.SAT_MAX_PRICE_IMPACT_PCT}% guardrail.`] };
  }

  const wallet = opts.wallet ?? PREVIEW_ACCOUNT;
  steps.push({
    label:
      intent.side === "buy"
        ? `Swap ${intent.amount} ${cfg.RH_NATIVE_SYMBOL} for ${market.token.symbol}`
        : `Swap ${intent.amount} ${market.token.symbol} for ${cfg.RH_NATIVE_SYMBOL}`,
    to: router,
    value: intent.side === "buy" ? amountIn.toString() : "0",
    data: intent.side === "buy" ? encodeRoutedBuy(route, minOut, wallet, fee) : encodeRoutedSell(route, minOut, wallet, fee),
  });

  const warnings: string[] = [];
  if (route.tokens.length > 2) warnings.push(`Routed through ${market.quoteSymbol}: ${cfg.RH_NATIVE_SYMBOL} → ${market.quoteSymbol} → ${market.token.symbol}.`);
  if (impact !== null && impact > IMPACT_WARN_PCT) warnings.push(`High price impact: about ${impact.toFixed(1)}% including pool fees.`);

  return {
    market,
    errors: [],
    trade: {
      venue: "uniswap-v3",
      side: intent.side,
      symbol: market.token.symbol,
      tokenAddress: token,
      chainId: cfg.RH_CHAIN_ID,
      amountIn: intent.side === "buy" ? `${intent.amount} ${cfg.RH_NATIVE_SYMBOL}` : `${intent.amount} ${market.token.symbol}`,
      estimatedOut: fmtUnits(netOfFee(route.amountOut, fee), outDecimals, outSymbol),
      minOut: fmtUnits(netOfFee(minOut, fee), outDecimals, outSymbol),
      slippageBps: slippage,
      notionalUsd: inUsd,
      steps,
      warnings,
      priceImpactPct: impact,
      exact: true,
      feeBps: fee?.bips ?? 0,
      feeUsd: fee ? (outUsd * fee.bips) / 10_000 : 0,
    },
  };
}

/** SAT itself, through the Pons swap router into its Uniswap v4 pool. */
async function prepareSat(intent: TradeIntent, market: TokenMarket, nativeUsd: number, opts: PrepareOptions, cfg: SatConfig): Promise<Prepared> {
  const errors: string[] = [];
  const slippage = intent.slippageBps ?? cfg.SAT_MAX_SLIPPAGE_BPS;
  if (slippage > cfg.SAT_MAX_SLIPPAGE_BPS) errors.push(`Slippage ${slippage}bps exceeds the ${cfg.SAT_MAX_SLIPPAGE_BPS}bps guardrail.`);
  const notionalUsd = intent.side === "buy" ? intent.amount * nativeUsd : intent.amount * market.priceUsd;
  if (notionalUsd > cfg.SAT_MAX_TRADE_NATIVE * nativeUsd) {
    errors.push(`Trade size $${notionalUsd.toFixed(2)} exceeds the ${cfg.SAT_MAX_TRADE_NATIVE} ${cfg.RH_NATIVE_SYMBOL} per-trade guardrail.`);
  }
  if (errors.length) return { trade: null, market, errors };

  const amountIn = intent.side === "buy" ? parseEther(intent.amount.toFixed(18)) : unitsOf(intent.amount, 18);
  const steps: TxStep[] = [];
  if (opts.wallet) {
    const balance = intent.side === "buy" ? await balanceOf(null, opts.wallet) : await satBalance(opts.wallet);
    if (balance < amountIn) {
      const have = intent.side === "buy" ? fmtUnits(balance, 18, cfg.RH_NATIVE_SYMBOL) : fmtSat(balance);
      return { trade: null, market, errors: [`Not enough balance: this wallet holds ${have}.`] };
    }
    if (intent.side === "sell" && (await satAllowance(opts.wallet)) < amountIn) {
      steps.push({ label: `Approve exactly ${intent.amount} SAT for the Pons swap router`, to: market.token.address, value: "0", data: satApproveData(amountIn) });
    }
  }

  const q = await quoteSatSwap(intent.side, amountIn, opts.wallet);
  const minOut = minOutOf(q.amountOut, slippage);
  const out = Number(q.amountOut) / 1e18;
  const outUsd = intent.side === "buy" ? out * market.priceUsd : out * nativeUsd;
  // Everything between spot and what arrives: pool impact, the router's 1% and the hook's tax.
  const impact = notionalUsd > 0 ? Math.max(0, (1 - outUsd / notionalUsd) * 100) : null;
  if (impact !== null && impact > cfg.SAT_MAX_PRICE_IMPACT_PCT) {
    return { trade: null, market, errors: [`Price impact ${impact.toFixed(1)}% is above the ${cfg.SAT_MAX_PRICE_IMPACT_PCT}% guardrail (router fee and pool tax included).`] };
  }

  steps.push({
    label: intent.side === "buy" ? `Buy SAT with ${intent.amount} ${cfg.RH_NATIVE_SYMBOL}` : `Sell ${intent.amount} SAT for ${cfg.RH_NATIVE_SYMBOL}`,
    to: PONS_SWAP_ROUTER,
    value: intent.side === "buy" ? amountIn.toString() : "0",
    data: encodeSatSwap(intent.side, amountIn, minOut),
  });

  const warnings = [`Routed through the Pons swap router: ${intent.side === "buy" ? "ETH → USDG → SAT" : "SAT → USDG → ETH"}. Includes its 1% fee and the SAT pool's tax.`];
  // A normal SAT trade costs ~4% (router 1% + hook tax), so warn only beyond that.
  if (impact !== null && impact > IMPACT_WARN_PCT + ROUTER_FEE_BPS / 100 + 2) warnings.push(`High cost: about ${impact.toFixed(1)}% between spot and what you receive.`);

  return {
    market,
    errors: [],
    trade: {
      venue: "uniswap-v4",
      side: intent.side,
      symbol: "SAT",
      tokenAddress: getAddress(market.token.address),
      chainId: cfg.RH_CHAIN_ID,
      amountIn: intent.side === "buy" ? `${intent.amount} ${cfg.RH_NATIVE_SYMBOL}` : `${intent.amount} SAT`,
      estimatedOut: intent.side === "buy" ? fmtSat(q.amountOut) : fmtEth(q.amountOut, cfg.RH_NATIVE_SYMBOL),
      minOut: intent.side === "buy" ? fmtSat(minOut) : fmtEth(minOut, cfg.RH_NATIVE_SYMBOL),
      slippageBps: slippage,
      notionalUsd,
      steps,
      warnings,
      priceImpactPct: impact,
      exact: true,
      feeBps: 0,
      feeUsd: 0,
    },
  };
}

async function preparePons(
  intent: TradeIntent,
  market: TokenMarket,
  nativeUsd: number,
  opts: PrepareOptions,
  cfg: SatConfig,
  provider: ReturnType<typeof getProvider>,
): Promise<Prepared> {
  if (!(provider instanceof RobinhoodChainProvider)) return { trade: null, market, errors: ["Pons trades need the live chain provider."] };
  const launch = await findLaunch(market.token.address);
  if (!launch) return { trade: null, market, errors: ["Could not find this token's Pons curve."] };
  const quote = quoteOf(launch.pairToken, await provider.quoteBook());
  if (!quote) return { trade: null, market, errors: ["Could not price this curve's quote asset."] };

  const errors: string[] = [];
  const slippage = intent.slippageBps ?? cfg.SAT_MAX_SLIPPAGE_BPS;
  if (slippage > cfg.SAT_MAX_SLIPPAGE_BPS) errors.push(`Slippage ${slippage}bps exceeds the ${cfg.SAT_MAX_SLIPPAGE_BPS}bps guardrail.`);
  const notionalUsd = intent.side === "buy" ? intent.amount * quote.usd : intent.amount * market.priceUsd;
  if (notionalUsd > cfg.SAT_MAX_TRADE_NATIVE * nativeUsd) {
    errors.push(`Trade size $${notionalUsd.toFixed(2)} exceeds the ${cfg.SAT_MAX_TRADE_NATIVE} ${cfg.RH_NATIVE_SYMBOL} per-trade guardrail.`);
  }
  if (errors.length) return { trade: null, market, errors };

  const token = getAddress(market.token.address);
  const curve = launch.curve;
  const native = isNativePair(launch.pairToken);
  const inputToken = intent.side === "buy" ? (native ? null : getAddress(launch.pairToken)) : token;
  const inDecimals = intent.side === "buy" ? quote.decimals : market.token.decimals;
  const amountIn = unitsOf(intent.amount, inDecimals);
  const inSymbol = intent.side === "buy" ? quote.symbol : market.token.symbol;
  const outDecimals = intent.side === "buy" ? market.token.decimals : quote.decimals;
  const outSymbol = intent.side === "buy" ? market.token.symbol : quote.symbol;

  const steps: TxStep[] = [];
  let approvalShort = false;
  if (opts.wallet) {
    const balance = await balanceOf(inputToken, opts.wallet);
    if (balance < amountIn) {
      return { trade: null, market, errors: [`Not enough balance: this wallet holds ${fmtUnits(balance, inDecimals, inSymbol)}.`] };
    }
    if (inputToken && (await allowanceOf(inputToken, opts.wallet, curve)) < amountIn) {
      approvalShort = true;
      steps.push({
        label: `Approve exactly ${intent.amount} ${inSymbol} for the ${market.token.symbol} curve`,
        to: inputToken,
        value: "0",
        data: approveData(curve, amountIn),
      });
    }
  }

  // Simulate from the real wallet when it can pay; a native buy preview can use a funded stand-in.
  const account = opts.wallet ?? PREVIEW_ACCOUNT;
  const canSimulate = !approvalShort && (opts.wallet !== null || (intent.side === "buy" && native));
  const q = await quoteCurve(curve, intent.side, amountIn, { account, nativePair: native, canSimulate });
  const minOut = minOutOf(q.amountOut, slippage);
  const impact = impactPct(q.amountOut, q.spotOut);
  if (impact > cfg.SAT_MAX_PRICE_IMPACT_PCT) {
    return { trade: null, market, errors: [`Price impact ${impact.toFixed(1)}% is above the ${cfg.SAT_MAX_PRICE_IMPACT_PCT}% guardrail (curve fee and launch tax included).`] };
  }

  const warnings: string[] = [];
  if (!q.exact) warnings.push("Estimated from curve reserves with the 1% fee; launch tax is not included until the trade can be simulated.");
  if (impact > IMPACT_WARN_PCT) warnings.push(`High price impact: about ${impact.toFixed(1)}% including the curve fee and launch tax.`);
  if (market.curve && market.curve.progressPct >= 97) warnings.push("This curve is about to graduate; a trade that crosses the threshold may revert.");

  if (!approvalShort) {
    steps.push({
      label:
        intent.side === "buy"
          ? `Buy ${market.token.symbol} with ${intent.amount} ${inSymbol} on its Pons curve`
          : `Sell ${intent.amount} ${market.token.symbol} on its Pons curve`,
      to: curve,
      value: intent.side === "buy" && native ? amountIn.toString() : "0",
      data: intent.side === "buy" ? curveBuyData(amountIn, minOut, account) : curveSellData(amountIn, minOut, account),
    });
  }

  return {
    market,
    errors: [],
    trade: {
      venue: "pons",
      side: intent.side,
      symbol: market.token.symbol,
      tokenAddress: token,
      chainId: cfg.RH_CHAIN_ID,
      amountIn: `${intent.amount} ${inSymbol}`,
      estimatedOut: fmtUnits(q.amountOut, outDecimals, outSymbol),
      minOut: fmtUnits(minOut, outDecimals, outSymbol),
      slippageBps: slippage,
      notionalUsd,
      steps,
      warnings,
      priceImpactPct: impact,
      exact: q.exact,
      needsRebuild: approvalShort,
    },
  };
}
