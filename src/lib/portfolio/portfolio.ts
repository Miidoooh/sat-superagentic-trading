import { decodeEventLog, erc20Abi, getAddress, parseAbiItem, type Log } from "viem";
import { cache } from "../cache";
import { getLogsClient, getPublicClient } from "../chain/client";
import { QUOTE_ASSETS } from "../chain/constants";
import { getConfig } from "../config";
import { blockClock, blockTime } from "../chain/logs";
import { findLaunch, quoteOf, type QuoteBook } from "../data/pons";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { classifySwap, stockIsToken0, unitsToNumber } from "../radar/whales";
import type { TokenMarket } from "../types";
import { computePnl, type Fill, type PnlResult } from "./pnl";

/**
 * A wallet's holdings and trade PnL, read straight from chain. Balances cover
 * every listed market plus anything the wallet traded through SAT. PnL comes
 * from the wallet's own fills over the last ~11 days: Pons curve events carry
 * exact quote amounts, and Stock Token fills are priced from the Uniswap swap
 * in the same transaction.
 */

/** Just under the node's 10M-block limit for a single-address query (~11.5 days). */
const WINDOW_BLOCKS = 9_900_000n;
const PORTFOLIO_TTL = 45 * 1000;
const MAX_PNL_TOKENS = 25;
const MAX_RECEIPTS_PER_TOKEN = 60;
const MAX_EXTRA_TOKENS = 30;
const DUST_USD = 0.01;
const RECENT_TRADES = 60;

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const CURVE_BUY = parseAbiItem(
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
);
const CURVE_SELL = parseAbiItem(
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
);

export interface Holding extends PnlResult {
  token: `0x${string}`;
  symbol: string;
  name: string;
  logoUrl?: string;
  venue: TokenMarket["venue"];
  balance: number;
  priceUsd: number;
  valueUsd: number;
  change24hPct: number | null;
  fills: number;
}

export interface PortfolioTrade {
  id: string;
  time: number;
  token: `0x${string}`;
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  usd: number;
  venue: TokenMarket["venue"];
  tx: `0x${string}`;
}

export interface Portfolio {
  address: `0x${string}`;
  nativeSymbol: string;
  native: { balance: number; valueUsd: number };
  totalUsd: number;
  tokensUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  windowDays: number;
  holdings: Holding[];
  trades: PortfolioTrade[];
  /** Tokens whose history could not be read this time. */
  partial: string[];
  updatedAt: number;
}

interface TimedFill extends Fill {
  block: bigint;
  logIndex: number;
  tx: `0x${string}`;
}

/** The public node rate-limits and sometimes drops a batched response; one retry usually clears it. */
async function withRetry<T>(fn: () => Promise<T>, delayMs = 600): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

async function balancesOf(wallet: `0x${string}`, tokens: TokenMarket[]): Promise<Map<string, bigint>> {
  const client = getPublicClient();
  const results = await client.multicall({
    contracts: tokens.map((t) => ({ address: t.token.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [wallet] as const })),
    allowFailure: true,
  });
  const out = new Map<string, bigint>();
  tokens.forEach((t, i) => {
    const r = results[i];
    if (r.status === "success" && (r.result as bigint) > 0n) out.set(t.token.address.toLowerCase(), r.result as bigint);
  });
  return out;
}

async function ponsFills(wallet: `0x${string}`, market: TokenMarket, book: QuoteBook, from: bigint, to: bigint): Promise<TimedFill[]> {
  const launch = await findLaunch(market.token.address);
  if (!launch) return [];
  const quote = quoteOf(launch.pairToken, book);
  if (!quote) return [];
  const client = getLogsClient();
  const [buys, sells] = await Promise.all([
    client.getLogs({ address: launch.curve, event: CURVE_BUY, args: { recipient: wallet }, fromBlock: from, toBlock: to }),
    client.getLogs({ address: launch.curve, event: CURVE_SELL, args: { recipient: wallet }, fromBlock: from, toBlock: to }),
  ]);
  const dec = market.token.decimals;
  return [
    ...buys.map((l) => ({
      side: "buy" as const,
      amount: unitsToNumber(l.args.tokensOut ?? 0n, dec),
      usd: unitsToNumber(l.args.quoteIn ?? 0n, quote.decimals) * quote.usd,
      block: l.blockNumber,
      logIndex: l.logIndex,
      tx: l.transactionHash,
    })),
    ...sells.map((l) => ({
      side: "sell" as const,
      amount: unitsToNumber(l.args.tokensIn ?? 0n, dec),
      usd: unitsToNumber(l.args.quoteOut ?? 0n, quote.decimals) * quote.usd,
      block: l.blockNumber,
      logIndex: l.logIndex,
      tx: l.transactionHash,
    })),
  ];
}

async function receiptLogs(tx: `0x${string}`): Promise<Log[]> {
  // Receipts never change, so they are cached for as long as the process lives.
  return cache.get(`receipt:${tx}`, 24 * 60 * 60 * 1000, async () => (await getPublicClient().getTransactionReceipt({ hash: tx })).logs);
}

async function stockFills(
  wallet: `0x${string}`,
  market: TokenMarket,
  ethUsd: number,
  from: bigint,
  to: bigint,
): Promise<TimedFill[]> {
  const quote = QUOTE_ASSETS.find((q) => q.symbol === market.quoteSymbol);
  if (!quote) return [];
  const client = getLogsClient();
  const [incoming, outgoing] = await Promise.all([
    client.getLogs({ address: market.token.address, event: TRANSFER, args: { to: wallet }, fromBlock: from, toBlock: to }),
    client.getLogs({ address: market.token.address, event: TRANSFER, args: { from: wallet }, fromBlock: from, toBlock: to }),
  ]);
  const txs = [...new Set([...incoming, ...outgoing].map((l) => l.transactionHash))].slice(-MAX_RECEIPTS_PER_TOKEN);
  const pool = market.poolAddress.toLowerCase();
  const stockFirst = stockIsToken0(market.token.address, quote.address);
  const quoteUsd = quote.kind === "stable" ? 1 : ethUsd;
  const fills: TimedFill[] = [];
  for (const tx of txs) {
    const logs = await receiptLogs(tx).catch(() => [] as Log[]);
    for (const log of logs) {
      if (log.address.toLowerCase() !== pool) continue;
      try {
        const { args } = decodeEventLog({ abi: [SWAP], data: log.data, topics: log.topics });
        const { side, stock } = classifySwap(args.amount0, args.amount1, stockFirst);
        const quoteRaw = stockFirst ? args.amount1 : args.amount0;
        fills.push({
          side,
          amount: unitsToNumber(stock, market.token.decimals),
          usd: unitsToNumber(quoteRaw < 0n ? -quoteRaw : quoteRaw, quote.decimals) * quoteUsd,
          block: log.blockNumber ?? 0n,
          logIndex: log.logIndex ?? 0,
          tx,
        });
      } catch {
        /* not a swap log */
      }
    }
  }
  return fills;
}

export async function getPortfolio(provider: RobinhoodChainProvider, address: string, extra: string[] = []): Promise<Portfolio> {
  const wallet = getAddress(address);
  const extraKey = [...new Set(extra.map((e) => e.toLowerCase()))].sort().slice(0, MAX_EXTRA_TOKENS);
  return cache.get(`portfolio:${wallet}:${extraKey.join(",")}`, PORTFOLIO_TTL, () => buildPortfolio(provider, wallet, extraKey));
}

async function buildPortfolio(provider: RobinhoodChainProvider, wallet: `0x${string}`, extra: string[]): Promise<Portfolio> {
  const [listed, book, ethUsd, clock, nativeRaw] = await Promise.all([
    provider.listTokens(500),
    provider.quoteBook(),
    provider.nativeUsd(),
    blockClock(),
    withRetry(() => getLogsClient().getBalance({ address: wallet })),
  ]);

  const markets = new Map(listed.map((m) => [m.token.address.toLowerCase(), m]));
  for (const addr of extra) {
    if (markets.has(addr)) continue;
    const m = await provider.findToken(addr).catch(() => null);
    if (m) markets.set(addr, m);
  }
  const all = [...markets.values()];
  const balances = await withRetry(() => balancesOf(wallet, all));

  const held = all
    .map((m) => {
      const raw = balances.get(m.token.address.toLowerCase()) ?? 0n;
      const balance = unitsToNumber(raw, m.token.decimals);
      return { m, balance, valueUsd: balance * m.priceUsd };
    })
    .filter((h) => h.balance > 0 && (h.valueUsd >= DUST_USD || extra.includes(h.m.token.address.toLowerCase())));

  // Also read history for tokens traded through SAT that are fully sold, so realized PnL shows.
  const pnlTargets = [
    ...held.sort((a, b) => b.valueUsd - a.valueUsd).map((h) => h.m),
    ...extra.map((a) => markets.get(a)).filter((m): m is TokenMarket => !!m && !held.some((h) => h.m === m)),
  ].slice(0, MAX_PNL_TOKENS);

  const from = clock.head > WINDOW_BLOCKS ? clock.head - WINDOW_BLOCKS : 0n;
  const partial: string[] = [];
  const fillsByToken = new Map<string, TimedFill[]>();
  await Promise.all(
    pnlTargets.map(async (m) => {
      try {
        const fills = await withRetry(
          () => (m.venue === "pons" ? ponsFills(wallet, m, book, from, clock.head) : stockFills(wallet, m, ethUsd, from, clock.head)),
          1_500,
        );
        fillsByToken.set(m.token.address.toLowerCase(), fills);
      } catch {
        partial.push(m.token.symbol);
      }
    }),
  );

  const holdings: Holding[] = pnlTargets.map((m) => {
    const key = m.token.address.toLowerCase();
    const balance = unitsToNumber(balances.get(key) ?? 0n, m.token.decimals);
    const fills = fillsByToken.get(key) ?? [];
    return {
      token: m.token.address,
      symbol: m.token.symbol,
      name: m.token.name,
      logoUrl: m.token.logoUrl,
      venue: m.venue,
      balance,
      priceUsd: m.priceUsd,
      valueUsd: balance * m.priceUsd,
      change24hPct: m.priceChange24hPct,
      fills: fills.length,
      ...computePnl(fills, balance, m.priceUsd),
    };
  });

  const trades: PortfolioTrade[] = pnlTargets
    .flatMap((m) =>
      (fillsByToken.get(m.token.address.toLowerCase()) ?? []).map((f) => ({
        id: `${f.tx}:${f.logIndex}`,
        time: blockTime(clock, f.block),
        token: m.token.address,
        symbol: m.token.symbol,
        side: f.side,
        amount: f.amount,
        usd: f.usd,
        venue: m.venue,
        tx: f.tx,
      })),
    )
    .sort((a, b) => b.time - a.time)
    .slice(0, RECENT_TRADES);

  const nativeBalance = unitsToNumber(nativeRaw, 18);
  const tokensUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);
  return {
    address: wallet,
    nativeSymbol: getConfig().RH_NATIVE_SYMBOL,
    native: { balance: nativeBalance, valueUsd: nativeBalance * ethUsd },
    tokensUsd,
    totalUsd: tokensUsd + nativeBalance * ethUsd,
    realizedUsd: holdings.reduce((s, h) => s + h.realizedUsd, 0),
    unrealizedUsd: holdings.reduce((s, h) => s + (h.unrealizedUsd ?? 0), 0),
    windowDays: Math.round((clock.headTime - blockTime(clock, from)) / 86_400),
    holdings: holdings.sort((a, b) => b.valueUsd - a.valueUsd || b.realizedUsd - a.realizedUsd),
    trades,
    partial,
    updatedAt: Date.now(),
  };
}
