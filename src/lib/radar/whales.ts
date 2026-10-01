import { parseAbiItem } from "viem";
import { QUOTE_ASSETS } from "../chain/constants";
import { getLogsClient } from "../chain/client";
import { blockClock, blocksFor, blockTime, POOL_QUERY_SPAN, RollingWindow, spanned } from "../chain/logs";
import { cache } from "../cache";
import { listLaunches, quoteOf, type PonsLaunch, type QuoteBook } from "../data/pons";
import { FLOW_WINDOW_SECONDS, pickTrader, recentCurveTrades, type RawCurveTrade } from "../data/ponsFlow";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { getTokenMeta } from "../data/tokenMeta";
import type { TokenMarket } from "../types";

const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const SWAPS_TTL = 8 * 1000;
const DAY_TTL = 30 * 1000;
const MAX_TRADES = 200;
const MAX_FLOWS = 10;

export type RadarVenue = "stock" | "pons";

export interface WhaleTrade {
  id: string;
  time: number;
  block: string;
  venue: RadarVenue;
  side: "buy" | "sell";
  token: `0x${string}`;
  symbol: string;
  logoUrl?: string;
  usd: number;
  tokens: number;
  quoteSymbol: string;
  trader: `0x${string}` | null;
  tx: `0x${string}`;
}

export interface FlowRow {
  token: `0x${string}`;
  symbol: string;
  venue: RadarVenue;
  logoUrl?: string;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  trades: number;
  traders: number;
}

export interface VenueTotals {
  buyUsd: number;
  sellUsd: number;
  trades: number;
}

export interface RadarSnapshot {
  head: string;
  headTime: number;
  windowMinutes: number;
  minUsd: number;
  trades: WhaleTrade[];
  inflows: FlowRow[];
  outflows: FlowRow[];
  totals: Record<RadarVenue, VenueTotals>;
}

export interface RawSwap {
  block: bigint;
  pool: `0x${string}`;
  amount0: bigint;
  amount1: bigint;
  trader: `0x${string}` | null;
  tx: `0x${string}`;
  logIndex: number;
}

/** Uniswap v3 orders a pool's tokens by address, so token0 is the lower one. */
export function stockIsToken0(stock: string, quote: string): boolean {
  return stock.toLowerCase() < quote.toLowerCase();
}

/**
 * Amounts are signed from the pool's side: a negative Stock Token amount
 * means the pool paid it out, i.e. the trader bought.
 */
export function classifySwap(amount0: bigint, amount1: bigint, stockFirst: boolean): { side: "buy" | "sell"; stock: bigint } {
  const stock = stockFirst ? amount0 : amount1;
  return { side: stock < 0n ? "buy" : "sell", stock: stock < 0n ? -stock : stock };
}

export function unitsToNumber(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Swaps on the given pools, optionally only those that paid out to one wallet. */
export async function readStockSwaps(
  pools: `0x${string}`[],
  from: bigint,
  to: bigint,
  recipient?: `0x${string}`,
): Promise<RawSwap[]> {
  const logs = await getLogsClient().getLogs({
    address: pools,
    event: SWAP_EVENT,
    args: recipient ? { recipient } : undefined,
    fromBlock: from,
    toBlock: to,
  });
  const out: RawSwap[] = [];
  for (const log of logs) {
    const { amount0, amount1, recipient: to_, sender } = log.args;
    if (amount0 === undefined || amount1 === undefined || !log.transactionHash || log.logIndex === null) continue;
    out.push({
      block: log.blockNumber ?? 0n,
      pool: log.address,
      amount0,
      amount1,
      trader: pickTrader(to_, sender),
      tx: log.transactionHash,
      logIndex: log.logIndex,
    });
  }
  return out;
}

const poolKey = (stocks: TokenMarket[]) => stocks.map((m) => m.poolAddress.toLowerCase()).sort().join(",");

/** One rolling window per pool set; rebuilt only if the stock universe changes. */
function stockWindowFactory(windowBlocks: bigint, wrap: (f: (a: bigint, b: bigint) => Promise<RawSwap[]>) => (a: bigint, b: bigint) => Promise<RawSwap[]>) {
  let current: { key: string; window: RollingWindow<RawSwap> } | null = null;
  return (stocks: TokenMarket[]) => {
    const key = poolKey(stocks);
    if (!current || current.key !== key) {
      const pools = stocks.map((m) => m.poolAddress);
      current = { key, window: new RollingWindow<RawSwap>(windowBlocks, wrap((a, b) => readStockSwaps(pools, a, b))) };
    }
    return current.window;
  };
}

const recentStockWindow = stockWindowFactory(blocksFor(FLOW_WINDOW_SECONDS), (f) => f);
const dayStockWindow = stockWindowFactory(blocksFor(86_400), (f) => spanned(POOL_QUERY_SPAN, 3, f));

async function recentStockSwaps(stocks: TokenMarket[]): Promise<RawSwap[]> {
  const window = recentStockWindow(stocks);
  return cache.get("radar:stock-swaps", SWAPS_TTL, async () => window.refresh((await blockClock()).head), { swr: true });
}

/** Every Stock Token swap in the last 24 hours. */
export async function dayStockSwaps(stocks: TokenMarket[]): Promise<RawSwap[]> {
  const window = dayStockWindow(stocks);
  return cache.get("radar:stock-swaps:24h", DAY_TTL, async () => window.refresh((await blockClock()).head), { swr: true });
}

export interface PricedTrade extends Omit<WhaleTrade, "symbol" | "time" | "block" | "id"> {
  blockNumber: bigint;
  logIndex: number;
  symbol?: string;
}

export function priceStockSwaps(swaps: RawSwap[], stocks: TokenMarket[]): PricedTrade[] {
  const quoteAddress = new Map(QUOTE_ASSETS.map((q) => [q.symbol, q.address]));
  const byPool = new Map(stocks.map((m) => [m.poolAddress.toLowerCase(), m]));
  const out: PricedTrade[] = [];
  for (const swap of swaps) {
    const market = byPool.get(swap.pool.toLowerCase());
    const quote = market && quoteAddress.get(market.quoteSymbol);
    if (!market || !quote) continue;
    const { side, stock } = classifySwap(swap.amount0, swap.amount1, stockIsToken0(market.token.address, quote));
    const tokens = unitsToNumber(stock, market.token.decimals);
    const usd = tokens * market.priceUsd;
    if (!Number.isFinite(usd) || usd <= 0) continue;
    out.push({
      venue: "stock",
      side,
      token: market.token.address,
      symbol: market.token.symbol,
      logoUrl: market.token.logoUrl,
      usd,
      tokens,
      quoteSymbol: market.quoteSymbol,
      trader: swap.trader,
      tx: swap.tx,
      blockNumber: swap.block,
      logIndex: swap.logIndex,
    });
  }
  return out;
}

export function priceCurveTrades(trades: RawCurveTrade[], launches: PonsLaunch[], book: QuoteBook): PricedTrade[] {
  const byCurve = new Map(launches.map((l) => [l.curve.toLowerCase(), l]));
  const out: PricedTrade[] = [];
  for (const trade of trades) {
    const launch = byCurve.get(trade.curve.toLowerCase());
    const quote = launch && quoteOf(launch.pairToken, book);
    if (!launch || !quote) continue;
    const usd = unitsToNumber(trade.quoteGross, quote.decimals) * quote.usd;
    if (!Number.isFinite(usd) || usd <= 0) continue;
    out.push({
      venue: "pons",
      side: trade.side,
      token: launch.token,
      usd,
      tokens: unitsToNumber(trade.tokens, 18),
      quoteSymbol: quote.symbol,
      trader: trade.trader,
      tx: trade.tx,
      blockNumber: trade.block,
      logIndex: trade.logIndex,
    });
  }
  return out;
}

export function aggregateFlows(trades: PricedTrade[]): FlowRow[] {
  const rows = new Map<string, FlowRow & { wallets: Set<string> }>();
  for (const t of trades) {
    const key = t.token.toLowerCase();
    let row = rows.get(key);
    if (!row) {
      row = {
        token: t.token,
        symbol: t.symbol ?? "",
        venue: t.venue,
        logoUrl: t.logoUrl,
        buyUsd: 0,
        sellUsd: 0,
        netUsd: 0,
        trades: 0,
        traders: 0,
        wallets: new Set(),
      };
      rows.set(key, row);
    }
    if (t.side === "buy") row.buyUsd += t.usd;
    else row.sellUsd += t.usd;
    row.netUsd = row.buyUsd - row.sellUsd;
    row.trades += 1;
    if (t.trader) row.wallets.add(t.trader.toLowerCase());
  }
  return [...rows.values()].map(({ wallets, ...row }) => ({ ...row, traders: wallets.size }));
}

export function totalsOf(trades: PricedTrade[]): Record<RadarVenue, VenueTotals> {
  const totals: Record<RadarVenue, VenueTotals> = {
    stock: { buyUsd: 0, sellUsd: 0, trades: 0 },
    pons: { buyUsd: 0, sellUsd: 0, trades: 0 },
  };
  for (const t of trades) {
    const v = totals[t.venue];
    if (t.side === "buy") v.buyUsd += t.usd;
    else v.sellUsd += t.usd;
    v.trades += 1;
  }
  return totals;
}

/** Shared snapshots are stored at full length and trimmed per request. */
export const RADAR_MAX_TRADES = MAX_TRADES;
export const RADAR_FRESH_MS = 10 * 1000;
export { RADAR_SIZES } from "../alerts/detect";
export const radarKey = (venue: string, minUsd: number) => `radar:${venue}:${minUsd}`;

export interface RadarOptions {
  minUsd: number;
  venue: "all" | RadarVenue;
  limit?: number;
  /** Trades by these wallets are listed at any size. */
  wallets?: string[];
}

/** Large trades and net money flow across Stock Token pools and Pons curves, last 30 minutes. */
export async function getWhaleRadar(provider: RobinhoodChainProvider, opts: RadarOptions): Promise<RadarSnapshot> {
  const [clock, stocks, book] = await Promise.all([blockClock(), provider.baseStocks(), provider.quoteBook()]);
  const [stockSwaps, curveTrades, launches] = await Promise.all([
    recentStockSwaps(stocks).catch(() => [] as RawSwap[]),
    recentCurveTrades().catch(() => [] as RawCurveTrade[]),
    listLaunches().catch(() => [] as PonsLaunch[]),
  ]);

  const all = [...priceStockSwaps(stockSwaps, stocks), ...priceCurveTrades(curveTrades, launches, book)];
  const scoped = opts.venue === "all" ? all : all.filter((t) => t.venue === opts.venue);
  const followed = new Set((opts.wallets ?? []).map((w) => w.toLowerCase()));
  const big = scoped
    .filter((t) => t.usd >= opts.minUsd || (t.trader !== null && followed.has(t.trader.toLowerCase())))
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
    .slice(0, Math.min(opts.limit ?? 120, MAX_TRADES));

  const flows = aggregateFlows(scoped);
  const inflows = flows.filter((f) => f.netUsd > 0).sort((a, b) => b.netUsd - a.netUsd).slice(0, MAX_FLOWS);
  const outflows = flows.filter((f) => f.netUsd < 0).sort((a, b) => a.netUsd - b.netUsd).slice(0, MAX_FLOWS);

  // Launch tokens have no symbol until we read it; only fetch what is on screen.
  const unnamed = [...big, ...inflows, ...outflows].filter((t) => !t.symbol).map((t) => t.token);
  const meta = await getTokenMeta(unnamed).catch(() => new Map());
  const symbolOf = (token: string, fallback?: string) => fallback || meta.get(token.toLowerCase())?.symbol || `${token.slice(0, 6)}…`;

  return {
    head: clock.head.toString(),
    headTime: clock.headTime,
    windowMinutes: FLOW_WINDOW_SECONDS / 60,
    minUsd: opts.minUsd,
    trades: big.map(({ blockNumber, logIndex, ...t }) => ({
      ...t,
      id: `${t.tx}:${logIndex}`,
      symbol: symbolOf(t.token, t.symbol),
      block: blockNumber.toString(),
      time: blockTime(clock, blockNumber),
    })),
    inflows: inflows.map((f) => ({ ...f, symbol: symbolOf(f.token, f.symbol) })),
    outflows: outflows.map((f) => ({ ...f, symbol: symbolOf(f.token, f.symbol) })),
    totals: totalsOf(all),
  };
}
