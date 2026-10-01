import { z } from "zod";
import { analyzeChart } from "../analysis/analyze";
import { getProvider } from "../data/provider";
import { RobinhoodChainProvider } from "../data/robinhood";
import { getTrenches } from "../radar/trenches";
import { getLeaderboard, getWalletActivity } from "../radar/wallets";
import { getWhaleRadar } from "../radar/whales";
import { getOnchainSnapshot, getWalletBalances } from "../chain/onchain";
import { ScanCriteriaSchema } from "../scanner/criteria";
import { scanTokens } from "../scanner/scan";
import { prepareTrade } from "../trade/prepare";
import { TradeIntentSchema } from "../trade/trade";
import type { TokenMarket, Timeframe } from "../types";

export type Artifact =
  | { type: "scan"; data: Awaited<ReturnType<typeof scanTokens>> }
  | { type: "analysis"; symbol: string; timeframe: Timeframe; source: string; data: ReturnType<typeof analyzeChart> }
  | { type: "trade"; data: TradeProposal };

export interface TradeProposal {
  ok: boolean;
  errors: string[];
  intent: z.infer<typeof TradeIntentSchema>;
  symbol: string;
  preview?: { amountIn: string; estimatedOut: string; minOut: string; slippageBps: number; notionalUsd: number; warnings: string[] };
  requiresUserApproval: true;
}

export interface ToolOutcome {
  result: unknown;
  artifact?: Artifact;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: unknown) => Promise<ToolOutcome>;
}

const TF = z.enum(["5m", "15m", "1h", "4h", "1d"]);
const TF_SCHEMA = { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] };

async function resolve(query: string): Promise<TokenMarket> {
  const m = await getProvider().findToken(query);
  if (!m) throw new Error(`Token "${query}" not found on Robinhood Chain data source`);
  return m;
}

const round = (v: number | null, digits = 2) =>
  v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));

function marketSummary(m: TokenMarket) {
  return {
    symbol: m.token.symbol,
    name: m.token.name,
    address: m.token.address,
    priceUsd: round(m.priceUsd, 6),
    oraclePriceUsd: round(m.oraclePriceUsd, 6),
    oracleBasisPct: round(m.oracleBasisPct),
    oracleStale: m.oracleStale,
    pool: { address: m.poolAddress, quote: m.quoteSymbol, feeTier: m.feeTier },
    liquidityUsd: round(m.liquidityUsd, 0),
    volume24hUsd: round(m.volume24hUsd, 0),
    change1hPct: round(m.priceChange1hPct),
    change24hPct: round(m.priceChange24hPct),
    ageDays: m.createdAt === null ? null : Math.round((Date.now() / 1000 - m.createdAt) / 86400),
    tradableNow: m.tradableNow,
    hasPriceHistory: m.hasPriceHistory,
    venue: m.venue,
    curve: m.curve,
  };
}

function timeframesOf(market: TokenMarket): readonly Timeframe[] {
  const p = getProvider();
  return p instanceof RobinhoodChainProvider ? p.timeframesFor(market) : p.supportedTimeframes;
}

function pickTimeframe(market: TokenMarket, requested: Timeframe | undefined): Timeframe {
  const allowed = timeframesOf(market);
  const tf = requested ?? (allowed.includes("1h") ? "1h" : allowed.includes("4h") ? "4h" : allowed[0]);
  if (!allowed.includes(tf)) {
    throw new Error(`Timeframe ${tf} unsupported for ${market.token.symbol}. Supported: ${allowed.join(", ")}`);
  }
  return tf;
}

const tools: ToolDef[] = [
  {
    name: "list_market",
    description: "List the most active tokens on Robinhood Chain with price, liquidity, volume and changes.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
    async run(raw) {
      const { limit } = z.object({ limit: z.number().int().min(1).max(50).default(15) }).parse(raw ?? {});
      const p = getProvider();
      const all = (await p.listTokens(500)).slice(0, limit);
      return {
        result: {
          source: p.source,
          capabilities: p.capabilities,
          note: p.capabilities.volume24h ? undefined : "This data source cannot report trading volume.",
          tokens: all.map(marketSummary),
        },
      };
    },
  },
  {
    name: "analyze_chart",
    description:
      "Deep technical analysis of one token: trend, RSI, MACD, moving averages, Bollinger, ATR, support/resistance and pattern signals.",
    parameters: {
      type: "object",
      properties: {
        token: { type: "string", description: "Symbol, name fragment or 0x address" },
        timeframe: TF_SCHEMA,
      },
      required: ["token"],
      additionalProperties: false,
    },
    async run(raw) {
      const args = z.object({ token: z.string().min(1).max(80), timeframe: TF.optional() }).parse(raw);
      const p = getProvider();
      const market = await resolve(args.token);
      const tf = pickTimeframe(market, args.timeframe);
      const candles = await p.getCandles(market, tf, 300);
      const analysis = analyzeChart(candles, tf);
      return {
        result: { source: p.source, market: marketSummary(market), analysis },
        artifact: { type: "analysis", symbol: market.token.symbol, timeframe: tf, source: p.source, data: analysis },
      };
    },
  },
  {
    name: "detect_patterns",
    description: "Surface chart patterns for one token across every available timeframe (multi-timeframe confluence).",
    parameters: {
      type: "object",
      properties: { token: { type: "string" } },
      required: ["token"],
      additionalProperties: false,
    },
    async run(raw) {
      const { token } = z.object({ token: z.string().min(1).max(80) }).parse(raw);
      const p = getProvider();
      const market = await resolve(token);
      const perTimeframe = await Promise.all(
        timeframesOf(market).map(async (tf) => {
          const candles = await p.getCandles(market, tf, 300);
          const a = analyzeChart(candles, tf);
          return { timeframe: tf, trend: a.trend.direction, rsi14: a.indicators.rsi14, patterns: a.patterns };
        }),
      );
      return { result: { source: p.source, market: marketSummary(market), perTimeframe } };
    },
  },
  {
    name: "scan_tokens",
    description:
      "Scan all Robinhood Chain tokens for ones matching exact criteria (liquidity, volume, momentum, age, RSI, trend, patterns). Translate the user's request into these filters.",
    parameters: {
      type: "object",
      properties: {
        minLiquidityUsd: { type: "number" },
        maxLiquidityUsd: { type: "number" },
        minVolume24hUsd: { type: "number" },
        minPriceChange1hPct: { type: "number" },
        maxPriceChange1hPct: { type: "number" },
        minPriceChange24hPct: { type: "number" },
        maxPriceChange24hPct: { type: "number" },
        minAgeDays: { type: "number" },
        maxAgeDays: { type: "number" },
        symbolContains: { type: "string" },
        tradableNow: { type: "boolean" },
        maxOracleBasisPct: { type: "number", description: "Max absolute gap between pool price and oracle price, percent" },
        timeframe: TF_SCHEMA,
        rsiMin: { type: "number" },
        rsiMax: { type: "number" },
        trend: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        priceAboveSma20: { type: "boolean" },
        priceAboveSma50: { type: "boolean" },
        patternsAny: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "golden_cross", "death_cross", "macd_bull_cross", "macd_bear_cross", "rsi_overbought",
              "rsi_oversold", "breakout_up", "breakdown", "bb_squeeze", "double_top", "double_bottom",
              "rsi_bull_div", "rsi_bear_div",
            ],
          },
        },
        patternDirection: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        minPatternConfidence: { type: "number" },
        sortBy: { type: "string", enum: ["liquidity", "volume24h", "change1h", "change24h", "rsi", "patternConfidence"] },
        sortDir: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    async run(raw) {
      const provider = getProvider();
      const criteria = ScanCriteriaSchema.parse(raw ?? {});
      const result = await scanTokens(provider, criteria);
      const slim = {
        source: result.source,
        scanned: result.scanned,
        passedMarketFilters: result.passedMarketFilters,
        notes: result.notes,
        matches: result.matches.map((m) => ({
          ...marketSummary(m.market),
          reasons: m.reasons,
          rsi14: m.analysis?.indicators.rsi14 ?? null,
          trend: m.analysis?.trend.direction ?? null,
          patterns: m.analysis?.patterns.slice(0, 3).map((p) => `${p.name} (${p.direction}, ${p.confidence})`) ?? [],
        })),
      };
      return { result: slim, artifact: { type: "scan", data: result } };
    },
  },
  {
    name: "onchain_snapshot",
    description:
      "Real on-chain activity for one token over a recent window: swap volume and buy/sell split from its Uniswap pool, transfer count, unique wallets, mints/burns, whale transfers and the biggest net accumulators and distributors. This is the only way to get volume, and it works for one token at a time.",
    parameters: {
      type: "object",
      properties: {
        token: { type: "string", description: "Symbol or 0x address" },
        hours: { type: "number", minimum: 0.25, maximum: 24, description: "Lookback window in hours (default 6, max 24)" },
      },
      required: ["token"],
      additionalProperties: false,
    },
    async run(raw) {
      const args = z.object({ token: z.string().min(1).max(80), hours: z.number().min(0.25).max(24).optional() }).parse(raw);
      const p = getProvider();
      if (!p.capabilities.liveTrading) {
        return { result: { error: `On-chain snapshot unavailable: the ${p.source} data source has no real contracts.` } };
      }
      const market = await resolve(args.token);
      return { result: await getOnchainSnapshot(market, { hours: args.hours }) };
    },
  },
  {
    name: "wallet_balances",
    description: "Read native and ERC-20 balances for a wallet address on Robinhood Chain.",
    parameters: {
      type: "object",
      properties: {
        wallet: { type: "string" },
        tokens: { type: "array", items: { type: "string" }, description: "ERC-20 contract addresses" },
      },
      required: ["wallet"],
      additionalProperties: false,
    },
    async run(raw) {
      const args = z.object({ wallet: z.string(), tokens: z.array(z.string()).max(20).optional() }).parse(raw);
      return { result: await getWalletBalances(args.wallet, args.tokens ?? []) };
    },
  },
  {
    name: "whale_radar",
    description:
      "Live whale activity across every Stock Token pool and Pons bonding curve over the last 30 minutes: the biggest buys and sells, tokens with the most net inflow and outflow, and total buy vs sell pressure. Use it for questions about who is buying or selling, money flow, or market sentiment right now.",
    parameters: {
      type: "object",
      properties: {
        minUsd: { type: "number", minimum: 0, description: "Smallest trade to list, in USD (default 1000)" },
        venue: { type: "string", enum: ["all", "stock", "pons"] },
      },
      additionalProperties: false,
    },
    async run(raw) {
      const args = z
        .object({ minUsd: z.number().min(0).max(10_000_000).default(1000), venue: z.enum(["all", "stock", "pons"]).default("all") })
        .parse(raw ?? {});
      const p = getProvider();
      if (!(p instanceof RobinhoodChainProvider)) {
        return { result: { error: `Whale Radar needs live chain data; the ${p.source} source has none.` } };
      }
      const radar = await getWhaleRadar(p, { ...args, limit: 25 });
      const now = Math.floor(Date.now() / 1000);
      return {
        result: {
          windowMinutes: radar.windowMinutes,
          totals: radar.totals,
          trades: radar.trades.map((t) => ({
            side: t.side,
            symbol: t.symbol,
            venue: t.venue,
            usd: round(t.usd, 0),
            trader: t.trader,
            secondsAgo: now - t.time,
          })),
          inflows: radar.inflows.map(({ symbol, venue, netUsd, trades, traders }) => ({ symbol, venue, netUsd: round(netUsd, 0), trades, traders })),
          outflows: radar.outflows.map(({ symbol, venue, netUsd, trades, traders }) => ({ symbol, venue, netUsd: round(netUsd, 0), trades, traders })),
        },
      };
    },
  },
  {
    name: "pons_trenches",
    description:
      "Live state of the Pons launchpad: newest launches, curves closest to graduating to Uniswap (with % of target raised), the most traded curves in the last 30 minutes, and recent graduations. Use it for questions about new launches, memecoins, or what is about to graduate.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const p = getProvider();
      if (!(p instanceof RobinhoodChainProvider)) {
        return { result: { error: `Pons Trenches needs live chain data; the ${p.source} source has none.` } };
      }
      const t = await getTrenches(p);
      const card = (c: (typeof t.newest)[number]) => ({
        symbol: c.symbol,
        address: c.token,
        progressPct: c.progressPct,
        raisedUsd: round(c.raisedUsd, 0),
        buyUsd30m: round(c.flow.buyUsd, 0),
        sellUsd30m: round(c.flow.sellUsd, 0),
        url: c.url,
      });
      return {
        result: {
          stats: t.stats,
          newest: t.newest.slice(0, 10).map(card),
          graduating: t.graduating.slice(0, 10).map(card),
          hot: t.hot.slice(0, 10).map(card),
          graduated: t.graduated.slice(0, 8).map(({ symbol, token, liquidityUsd, url }) => ({ symbol, address: token, liquidityUsd: round(liquidityUsd, 0), url })),
        },
      };
    },
  },
  {
    name: "smart_money",
    description:
      "Wallet intelligence. Without a wallet: the top traders by volume and the biggest net buyers over the last 24 hours across stocks and Pons. With a wallet address: everything it bought and sold in the last 24 hours, per token. Use it for 'who is buying', 'what are the top wallets doing' or 'what did this wallet trade'.",
    parameters: {
      type: "object",
      properties: { wallet: { type: "string", description: "Optional 0x wallet address" } },
      additionalProperties: false,
    },
    async run(raw) {
      const { wallet } = z.object({ wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() }).parse(raw ?? {});
      const p = getProvider();
      if (!(p instanceof RobinhoodChainProvider)) {
        return { result: { error: `Wallet tracking needs live chain data; the ${p.source} source has none.` } };
      }
      if (wallet) {
        const a = await getWalletActivity(p, wallet);
        return {
          result: {
            wallet: a.wallet,
            windowHours: a.windowHours,
            totals: { ...a.totals, buyUsd: round(a.totals.buyUsd, 0), sellUsd: round(a.totals.sellUsd, 0), netUsd: round(a.totals.netUsd, 0) },
            positions: a.positions.slice(0, 15).map((x) => ({ ...x, buyUsd: round(x.buyUsd, 0), sellUsd: round(x.sellUsd, 0), netUsd: round(x.netUsd, 0) })),
          },
        };
      }
      const board = await getLeaderboard(p);
      const slim = (r: (typeof board.byVolume)[number]) => ({
        wallet: r.wallet,
        volumeUsd: round(r.volumeUsd, 0),
        netUsd: round(r.netUsd, 0),
        trades: r.trades,
        tokens: r.tokens,
        mostTraded: r.topSymbol,
      });
      return { result: { window: board.window, byVolume: board.byVolume.slice(0, 10).map(slim), byNetBuy: board.byNetBuy.slice(0, 10).map(slim) } };
    },
  },
  {
    name: "propose_trade",
    description:
      "Propose a swap for the user to review. This NEVER executes: the user must approve and sign in their own wallet. Guardrails on size, slippage and liquidity are enforced.",
    parameters: {
      type: "object",
      properties: {
        side: { type: "string", enum: ["buy", "sell"] },
        token: { type: "string", description: "0x token address (use list_market/analyze_chart to find it)" },
        amount: {
          type: "number",
          description: "buy: amount of the pay asset to spend (ETH, or the curve's quote token for ERC-20-paired Pons launches). sell: token amount to sell.",
        },
        slippageBps: { type: "integer", minimum: 1, maximum: 1000 },
        rationale: { type: "string" },
      },
      required: ["side", "token", "amount"],
      additionalProperties: false,
    },
    async run(raw) {
      const intent = TradeIntentSchema.parse(raw);
      const market = await resolve(intent.token);
      const { trade: built, errors } = await prepareTrade(
        { ...intent, token: market.token.address },
        { wallet: null, requireExecution: false },
      );
      let preview: TradeProposal["preview"];
      if (built) {
        preview = {
          amountIn: built.amountIn,
          estimatedOut: built.estimatedOut,
          minOut: built.minOut,
          slippageBps: built.slippageBps,
          notionalUsd: built.notionalUsd,
          warnings: built.warnings,
        };
      }
      const proposal: TradeProposal = {
        ok: errors.length === 0,
        errors,
        intent: { ...intent, token: market.token.address },
        symbol: market.token.symbol,
        preview,
        requiresUserApproval: true,
      };
      return { result: proposal, artifact: { type: "trade", data: proposal } };
    },
  },
];

export const toolDefinitions = tools.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

export async function runTool(name: string, rawArgs: string): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { result: { error: `Unknown tool ${name}` } };
  try {
    const args: unknown = rawArgs ? JSON.parse(rawArgs) : {};
    return await tool.run(args);
  } catch (err) {
    const message = err instanceof z.ZodError ? `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : (err as Error).message;
    return { result: { error: message } };
  }
}
