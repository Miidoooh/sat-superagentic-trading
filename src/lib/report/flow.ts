import { cache } from "../cache";
import { blockClock, blocksFor } from "../chain/logs";
import { sharedSnapshot } from "../store/snapshots";
import { listLaunches, recentGraduations, type PonsLaunch } from "../data/pons";
import { dayCurveTrades, recentCurveTrades } from "../data/ponsFlow";
import { ponsTokenDetail } from "../data/ponsToken";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { getTokenMeta } from "../data/tokenMeta";
import { getTrenches } from "../radar/trenches";
import { aggregateFlows, dayStockSwaps, priceCurveTrades, priceStockSwaps, totalsOf, type RadarVenue } from "../radar/whales";
import { getSatMarket } from "../sat/token";

/**
 * The daily Robinhood Chain flow report: the last 24 hours of stock-token and
 * Pons trading, distilled into what a trader would want to know. Built from the
 * same 24h trade windows the Smart Money board uses.
 */

export const REPORT_KEY = "report:daily:v3";
export const REPORT_FRESH_MS = 10 * 60 * 1000;
/** The 24h Pons history keeps loading in the background past this. */
const DAY_WAIT_MS = 45_000;

export interface ReportTrade {
  symbol: string;
  token: `0x${string}`;
  venue: RadarVenue;
  usd: number;
  trader: `0x${string}` | null;
  tx: `0x${string}`;
}

export interface ReportFlow {
  symbol: string;
  token: `0x${string}`;
  venue: RadarVenue;
  netUsd: number;
  buyUsd: number;
  sellUsd: number;
  traders: number;
}

export interface ReportLaunch {
  symbol: string;
  token: `0x${string}`;
  progressPct: number;
  raisedUsd: number;
  safety: { score: number; label: string } | null;
}

export interface FlowReport {
  /** UTC day the report covers, YYYY-MM-DD. */
  date: string;
  generatedAt: number;
  windowHours: number;
  /** 24, or 0.5 while the 24h Pons history is still loading. */
  ponsWindowHours: number;
  totals: {
    volumeUsd: number;
    stockUsd: number;
    ponsUsd: number;
    trades: number;
    wallets: number;
    buySharePct: number;
  };
  /** Pons tokens only: the report leads with them. */
  biggestBuys: ReportTrade[];
  inflows: ReportFlow[];
  outflows: ReportFlow[];
  stocks: { biggestBuys: ReportTrade[]; inflows: ReportFlow[]; outflows: ReportFlow[] };
  smartMoney: { wallet: `0x${string}`; netUsd: number; topSymbol: string }[];
  pons: { launches: number; graduations: number; graduated: string[] };
  watch: ReportLaunch[];
  sat: { priceUsd: number; change24hPct: number | null; marketCapUsd: number } | null;
}

const flowRow = (f: ReturnType<typeof aggregateFlows>[number]): ReportFlow => ({
  symbol: f.symbol,
  token: f.token,
  venue: f.venue,
  netUsd: f.netUsd,
  buyUsd: f.buyUsd,
  sellUsd: f.sellUsd,
  traders: f.traders,
});

interface PricedTrade {
  token: `0x${string}`;
  symbol?: string;
  side: "buy" | "sell";
  usd: number;
  trader: `0x${string}` | null;
}

/** Wallets with the biggest net buys, and the token each bought most of. */
export function topTokenBuyers(trades: PricedTrade[], n: number): { wallet: `0x${string}`; netUsd: number; topToken: `0x${string}`; topSymbol: string }[] {
  const byWallet = new Map<string, { wallet: `0x${string}`; netUsd: number; bought: Map<string, { token: `0x${string}`; symbol: string; usd: number }> }>();
  for (const t of trades) {
    if (!t.trader) continue;
    const key = t.trader.toLowerCase();
    const w = byWallet.get(key) ?? { wallet: t.trader, netUsd: 0, bought: new Map() };
    w.netUsd += t.side === "buy" ? t.usd : -t.usd;
    if (t.side === "buy") {
      const b = w.bought.get(t.token.toLowerCase()) ?? { token: t.token, symbol: t.symbol ?? "", usd: 0 };
      b.usd += t.usd;
      w.bought.set(t.token.toLowerCase(), b);
    }
    byWallet.set(key, w);
  }
  return [...byWallet.values()]
    .filter((w) => w.netUsd > 0 && w.bought.size > 0)
    .sort((a, b) => b.netUsd - a.netUsd)
    .slice(0, n)
    .map((w) => {
      const top = [...w.bought.values()].sort((a, b) => b.usd - a.usd)[0];
      return { wallet: w.wallet, netUsd: w.netUsd, topToken: top.token, topSymbol: top.symbol };
    });
}

/** The report, rebuilt at most every 10 minutes per process; stale copies are served while it rebuilds. */
export async function getFlowReport(provider: RobinhoodChainProvider): Promise<FlowReport> {
  return sharedSnapshot(REPORT_KEY, REPORT_FRESH_MS, () => cache.get("report:flow:v3", REPORT_FRESH_MS, () => buildFlowReport(provider), { swr: true }));
}

export async function buildFlowReport(provider: RobinhoodChainProvider): Promise<FlowReport> {
  const [clock, stocks, book, launches] = await Promise.all([
    blockClock(),
    provider.baseStocks(),
    provider.quoteBook(),
    listLaunches().catch(() => [] as PonsLaunch[]),
  ]);
  const [ponsDay, swaps, graduations, trenches, sat] = await Promise.all([
    Promise.race([dayCurveTrades().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), DAY_WAIT_MS))]),
    dayStockSwaps(stocks),
    recentGraduations().catch(() => []),
    getTrenches(provider).catch(() => null),
    getSatMarket().catch(() => null),
  ]);

  // Until the 24h Pons history has loaded, report its last 30 minutes and say so.
  const curve = ponsDay ?? (await recentCurveTrades().catch(() => []));
  const trades = [...priceStockSwaps(swaps, stocks), ...priceCurveTrades(curve, launches, book)];
  const totals = totalsOf(trades);
  const stockUsd = totals.stock.buyUsd + totals.stock.sellUsd;
  const ponsUsd = totals.pons.buyUsd + totals.pons.sellUsd;
  const buyUsd = totals.stock.buyUsd + totals.pons.buyUsd;
  const wallets = new Set(trades.map((t) => t.trader?.toLowerCase()).filter(Boolean));

  const flows = aggregateFlows(trades);
  const dayStart = clock.head > blocksFor(24 * 3600) ? clock.head - blocksFor(24 * 3600) : 0n;
  const dayGrads = graduations.filter((g) => g.block >= dayStart);
  const buysOf = (venue: RadarVenue) =>
    trades
      .filter((t) => t.venue === venue && t.side === "buy")
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 5);
  const inflowsOf = (venue: RadarVenue) =>
    flows
      .filter((f) => f.venue === venue && f.netUsd > 0)
      .sort((a, b) => b.netUsd - a.netUsd)
      .slice(0, 5);
  const outflowsOf = (venue: RadarVenue) =>
    flows
      .filter((f) => f.venue === venue && f.netUsd < 0)
      .sort((a, b) => a.netUsd - b.netUsd)
      .slice(0, 3);
  const [biggest, inflows, outflows] = [buysOf("pons"), inflowsOf("pons"), outflowsOf("pons")];
  const buyers = topTokenBuyers(trades.filter((t) => t.venue === "pons"), 3);
  const [stockBuys, stockIn, stockOut] = [buysOf("stock"), inflowsOf("stock"), outflowsOf("stock")];

  // Pons launches carry no symbol until read; fetch only what the report shows.
  const meta = await getTokenMeta([...[...biggest, ...inflows, ...outflows, ...dayGrads].map((t) => t.token), ...buyers.map((b) => b.topToken)]).catch(() => new Map());
  const symbolOf = (token: string, fallback?: string) => fallback || meta.get(token.toLowerCase())?.symbol || `${token.slice(0, 6)}…`;
  const tradeRow = (t: (typeof biggest)[number]): ReportTrade => ({ symbol: symbolOf(t.token, t.symbol), token: t.token, venue: t.venue, usd: t.usd, trader: t.trader, tx: t.tx });
  const named = (f: (typeof inflows)[number]): ReportFlow => ({ ...flowRow(f), symbol: symbolOf(f.token, f.symbol) });

  const candidates = (trenches?.graduating ?? []).slice(0, 3);
  const watch: ReportLaunch[] = await Promise.all(
    candidates.map(async (c) => {
      const detail = await ponsTokenDetail(c.token, book).catch(() => null);
      return {
        symbol: c.symbol,
        token: c.token,
        progressPct: c.progressPct,
        raisedUsd: c.raisedUsd,
        safety: detail ? { score: detail.safety.score, label: detail.safety.label } : null,
      };
    }),
  );

  return {
    date: new Date(clock.headTime * 1000).toISOString().slice(0, 10),
    generatedAt: Date.now(),
    windowHours: 24,
    ponsWindowHours: ponsDay ? 24 : 0.5,
    totals: {
      volumeUsd: stockUsd + ponsUsd,
      stockUsd,
      ponsUsd,
      trades: trades.length,
      wallets: wallets.size,
      buySharePct: stockUsd + ponsUsd > 0 ? (buyUsd / (stockUsd + ponsUsd)) * 100 : 50,
    },
    biggestBuys: biggest.map(tradeRow),
    inflows: inflows.map(named),
    outflows: outflows.map(named),
    stocks: { biggestBuys: stockBuys.map(tradeRow), inflows: stockIn.map(named), outflows: stockOut.map(named) },
    smartMoney: buyers.map((b) => ({ wallet: b.wallet, netUsd: b.netUsd, topSymbol: symbolOf(b.topToken, b.topSymbol) })),
    pons: {
      launches: launches.filter((l) => l.block >= dayStart).length,
      graduations: dayGrads.length,
      graduated: dayGrads.slice(0, 5).map((g) => symbolOf(g.token)),
    },
    watch,
    sat: sat ? { priceUsd: sat.priceUsd, change24hPct: sat.change24hPct, marketCapUsd: sat.marketCapUsd } : null,
  };
}
