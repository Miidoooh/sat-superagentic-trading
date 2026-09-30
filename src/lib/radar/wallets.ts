import { getAddress } from "viem";
import { blockClock, blocksFor, blockTime, getLogsAdaptive, POOL_QUERY_SPAN, spanned } from "../chain/logs";
import { cache } from "../cache";
import { listLaunches, type PonsLaunch } from "../data/pons";
import { dayCurveTrades, readWalletCurveTrades, recentCurveTrades, type RawCurveTrade } from "../data/ponsFlow";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { getTokenMeta } from "../data/tokenMeta";
import {
  dayStockSwaps,
  priceCurveTrades,
  priceStockSwaps,
  readStockSwaps,
  type PricedTrade,
  type RadarVenue,
  type RawSwap,
} from "./whales";

const WALLET_TTL = 20 * 1000;
const LEADERBOARD_TTL = 30 * 1000;
/** How long the leaderboard waits on a cold 24h fill before answering from the last 30 minutes. */
const DAY_WAIT_MS = 8 * 1000;
const TOP_TRADERS = 50;

export interface TraderRow {
  wallet: `0x${string}`;
  volumeUsd: number;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  trades: number;
  tokens: number;
  topSymbol: string;
}

export interface Leaderboard {
  window: "24h" | "30m";
  warming: boolean;
  byVolume: TraderRow[];
  byNetBuy: TraderRow[];
}

export interface WalletPosition {
  token: `0x${string}`;
  symbol: string;
  venue: RadarVenue;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  trades: number;
}

export interface WalletActivity {
  wallet: `0x${string}`;
  windowHours: number;
  totals: { buyUsd: number; sellUsd: number; netUsd: number; trades: number; firstSeen: number | null; lastSeen: number | null };
  positions: WalletPosition[];
  trades: {
    id: string;
    time: number;
    venue: RadarVenue;
    side: "buy" | "sell";
    token: `0x${string}`;
    symbol: string;
    usd: number;
    tx: `0x${string}`;
  }[];
}

/** Per-wallet totals; trades with no identifiable wallet are skipped. */
export function rankTraders(trades: PricedTrade[]): TraderRow[] {
  const rows = new Map<string, TraderRow & { perToken: Map<string, { usd: number; symbol: string }> }>();
  for (const t of trades) {
    if (!t.trader) continue;
    const key = t.trader.toLowerCase();
    let row = rows.get(key);
    if (!row) {
      row = { wallet: t.trader, volumeUsd: 0, buyUsd: 0, sellUsd: 0, netUsd: 0, trades: 0, tokens: 0, topSymbol: "", perToken: new Map() };
      rows.set(key, row);
    }
    if (t.side === "buy") row.buyUsd += t.usd;
    else row.sellUsd += t.usd;
    row.volumeUsd += t.usd;
    row.netUsd = row.buyUsd - row.sellUsd;
    row.trades += 1;
    const tk = t.token.toLowerCase();
    const entry = row.perToken.get(tk) ?? { usd: 0, symbol: t.symbol ?? tk };
    entry.usd += t.usd;
    row.perToken.set(tk, entry);
  }
  return [...rows.values()].map(({ perToken, ...row }) => {
    let top = { usd: -1, symbol: "" };
    for (const e of perToken.values()) if (e.usd > top.usd) top = e;
    return { ...row, tokens: perToken.size, topSymbol: top.symbol };
  });
}

async function withSymbols<T extends { topSymbol: string }>(rows: T[]): Promise<T[]> {
  const unnamed = rows.filter((r) => r.topSymbol.startsWith("0x")).map((r) => r.topSymbol as `0x${string}`);
  const meta = await getTokenMeta(unnamed).catch(() => new Map());
  return rows.map((r) =>
    r.topSymbol.startsWith("0x") ? { ...r, topSymbol: meta.get(r.topSymbol.toLowerCase())?.symbol ?? `${r.topSymbol.slice(0, 6)}…` } : r,
  );
}

async function buildLeaderboard(provider: RobinhoodChainProvider): Promise<Leaderboard> {
  const [stocks, book, launches] = await Promise.all([provider.baseStocks(), provider.quoteBook(), listLaunches().catch(() => [] as PonsLaunch[])]);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DAY_WAIT_MS));
  const day = await Promise.race([
    Promise.all([dayCurveTrades(), dayStockSwaps(stocks)]).catch((err: unknown) => {
      console.error("24h trade window failed:", err instanceof Error ? err.message.slice(0, 300) : err);
      return null;
    }),
    timeout,
  ]);

  let curve: RawCurveTrade[];
  let swaps: RawSwap[] = [];
  if (day) [curve, swaps] = day;
  else curve = await recentCurveTrades().catch(() => []);

  const priced = [...priceStockSwaps(swaps, stocks), ...priceCurveTrades(curve, launches, book)];
  const ranked = rankTraders(priced);
  const byVolume = [...ranked].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, TOP_TRADERS);
  const byNetBuy = ranked.filter((r) => r.netUsd > 0).sort((a, b) => b.netUsd - a.netUsd).slice(0, TOP_TRADERS);
  return {
    window: day ? "24h" : "30m",
    warming: !day,
    byVolume: await withSymbols(byVolume),
    byNetBuy: await withSymbols(byNetBuy),
  };
}

/** The most active and the most accumulating wallets across stocks and Pons curves. */
export async function getLeaderboard(provider: RobinhoodChainProvider): Promise<Leaderboard> {
  // A 30-minute stand-in is only cached briefly, so the 24h board replaces it once warm.
  const board = await cache.get("radar:leaderboard", LEADERBOARD_TTL, () => buildLeaderboard(provider), { swr: true });
  if (board.warming) cache.get("radar:leaderboard", 0, () => buildLeaderboard(provider)).catch(() => undefined);
  return board;
}

/** Everything one wallet traded on stocks and Pons curves in the last 24 hours. */
export async function getWalletActivity(provider: RobinhoodChainProvider, wallet: string): Promise<WalletActivity> {
  const address = getAddress(wallet);
  return cache.get(`radar:wallet:${address.toLowerCase()}`, WALLET_TTL, async () => {
    const [clock, stocks, book, launches] = await Promise.all([
      blockClock(),
      provider.baseStocks(),
      provider.quoteBook(),
      listLaunches().catch(() => [] as PonsLaunch[]),
    ]);
    const from = clock.head - blocksFor(86_400);
    const pools = stocks.map((m) => m.poolAddress);
    const [curve, swaps] = await Promise.all([
      getLogsAdaptive(from, clock.head, (a, b) => readWalletCurveTrades(a, b, address)),
      spanned(POOL_QUERY_SPAN, 3, (a, b) => readStockSwaps(pools, a, b, address))(from, clock.head),
    ]);
    const priced = [...priceStockSwaps(swaps, stocks), ...priceCurveTrades(curve, launches, book)].sort((a, b) =>
      a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1,
    );

    const unnamed = priced.filter((t) => !t.symbol).map((t) => t.token);
    const meta = await getTokenMeta(unnamed).catch(() => new Map());
    const symbolOf = (t: PricedTrade) => t.symbol || meta.get(t.token.toLowerCase())?.symbol || `${t.token.slice(0, 6)}…`;

    const positions = new Map<string, WalletPosition>();
    let buyUsd = 0;
    let sellUsd = 0;
    for (const t of priced) {
      const key = t.token.toLowerCase();
      const p = positions.get(key) ?? { token: t.token, symbol: symbolOf(t), venue: t.venue, buyUsd: 0, sellUsd: 0, netUsd: 0, trades: 0 };
      if (t.side === "buy") {
        p.buyUsd += t.usd;
        buyUsd += t.usd;
      } else {
        p.sellUsd += t.usd;
        sellUsd += t.usd;
      }
      p.netUsd = p.buyUsd - p.sellUsd;
      p.trades += 1;
      positions.set(key, p);
    }

    return {
      wallet: address,
      windowHours: 24,
      totals: {
        buyUsd,
        sellUsd,
        netUsd: buyUsd - sellUsd,
        trades: priced.length,
        firstSeen: priced.length ? blockTime(clock, priced[priced.length - 1].blockNumber) : null,
        lastSeen: priced.length ? blockTime(clock, priced[0].blockNumber) : null,
      },
      positions: [...positions.values()].sort((a, b) => b.buyUsd + b.sellUsd - (a.buyUsd + a.sellUsd)),
      trades: priced.slice(0, 150).map((t) => ({
        id: `${t.tx}:${t.logIndex}`,
        time: blockTime(clock, t.blockNumber),
        venue: t.venue,
        side: t.side,
        token: t.token,
        symbol: symbolOf(t),
        usd: t.usd,
        tx: t.tx,
      })),
    };
  });
}
