import { ponsTokenUrl } from "../chain/constants";
import { blockClock, blocksFor, blockTime, type BlockClock } from "../chain/logs";
import { cache } from "../cache";
import {
  listLaunches,
  quoteOf,
  readCurveStates,
  recentGraduations,
  scanCurves,
  type CurveState,
  type PonsLaunch,
  type QuoteBook,
} from "../data/pons";
import { FLOW_WINDOW_SECONDS, recentCurveTrades, type RawCurveTrade } from "../data/ponsFlow";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { getTokenMeta } from "../data/tokenMeta";
import { unitsToNumber } from "./whales";

const TRENCHES_TTL = 6 * 1000;
export const TRENCHES_KEY = "trenches";
export const TRENCHES_FRESH_MS = 12 * 1000;
const NEWEST = 30;
const GRADUATING = 24;
const HOT = 18;
const GRADUATED = 20;

export interface CurveFlow {
  buyUsd: number;
  sellUsd: number;
  trades: number;
  traders: number;
}

export interface TrenchCard {
  token: `0x${string}`;
  curve: `0x${string}`;
  symbol: string;
  name: string;
  deployer: `0x${string}`;
  launchedAt: number;
  quoteSymbol: string;
  priceUsd: number;
  raisedUsd: number;
  thresholdUsd: number;
  progressPct: number;
  flow: CurveFlow;
  url: string;
}

export interface GraduatedCard {
  token: `0x${string}`;
  symbol: string;
  name: string;
  graduatedAt: number;
  liquidityUsd: number | null;
  quoteSymbol: string;
  tx: `0x${string}`;
  url: string;
}

export interface TrenchesSnapshot {
  headTime: number;
  windowMinutes: number;
  stats: {
    launchesLastHour: number;
    graduationsLastDay: number;
    curveTrades: number;
    buyUsd: number;
    sellUsd: number;
    activeCurves: number;
  };
  newest: TrenchCard[];
  graduating: TrenchCard[];
  hot: TrenchCard[];
  graduated: GraduatedCard[];
}

const EMPTY_FLOW: CurveFlow = { buyUsd: 0, sellUsd: 0, trades: 0, traders: 0 };

/** Buy and sell USD per curve, keyed by lowercase curve address. */
export function flowByCurve(trades: RawCurveTrade[], launches: PonsLaunch[], book: QuoteBook): Map<string, CurveFlow> {
  const byCurve = new Map(launches.map((l) => [l.curve.toLowerCase(), l]));
  const acc = new Map<string, CurveFlow & { wallets: Set<string> }>();
  for (const t of trades) {
    const key = t.curve.toLowerCase();
    const launch = byCurve.get(key);
    const quote = launch && quoteOf(launch.pairToken, book);
    if (!quote) continue;
    const usd = unitsToNumber(t.quoteGross, quote.decimals) * quote.usd;
    if (!Number.isFinite(usd)) continue;
    let row = acc.get(key);
    if (!row) {
      row = { buyUsd: 0, sellUsd: 0, trades: 0, traders: 0, wallets: new Set() };
      acc.set(key, row);
    }
    if (t.side === "buy") row.buyUsd += usd;
    else row.sellUsd += usd;
    row.trades += 1;
    if (t.trader) row.wallets.add(t.trader.toLowerCase());
  }
  const out = new Map<string, CurveFlow>();
  for (const [key, { wallets, ...row }] of acc) out.set(key, { ...row, traders: wallets.size });
  return out;
}

async function build(provider: RobinhoodChainProvider): Promise<TrenchesSnapshot> {
  const [clock, book] = await Promise.all([blockClock(), provider.quoteBook()]);
  const [launches, trades, scan, graduations] = await Promise.all([
    listLaunches(),
    recentCurveTrades().catch(() => [] as RawCurveTrade[]),
    scanCurves(book).catch(() => [] as CurveState[]),
    recentGraduations().catch(() => []),
  ]);

  const launchByCurve = new Map(launches.map((l) => [l.curve.toLowerCase(), l]));
  const flows = flowByCurve(trades, launches, book);
  const flowOf = (curve: string) => flows.get(curve.toLowerCase()) ?? EMPTY_FLOW;

  const hotCurves = [...flows.entries()]
    .sort(([, a], [, b]) => b.buyUsd + b.sellUsd - (a.buyUsd + a.sellUsd))
    .slice(0, HOT)
    .map(([curve]) => launchByCurve.get(curve))
    .filter((l): l is PonsLaunch => Boolean(l));

  // The shared scan can be most of a minute old. New and hot curves move
  // fastest, so read those fresh in one multicall.
  const freshTargets = [...new Map([...launches.slice(0, NEWEST), ...hotCurves].map((l) => [l.curve, l])).values()];
  const fresh = await readCurveStates(freshTargets, book).catch(() => [] as CurveState[]);
  const stateByCurve = new Map(scan.map((s) => [s.launch.curve.toLowerCase(), s]));
  for (const s of fresh) stateByCurve.set(s.launch.curve.toLowerCase(), s);

  const newest = launches
    .slice(0, NEWEST)
    .map((l) => stateByCurve.get(l.curve.toLowerCase()))
    .filter((s): s is CurveState => Boolean(s));
  const graduating = scan
    .map((s) => stateByCurve.get(s.launch.curve.toLowerCase()) ?? s)
    .filter((s) => s.progress < 1 && s.raisedUsd > 0)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, GRADUATING);
  const hot = hotCurves
    .map((l) => stateByCurve.get(l.curve.toLowerCase()))
    .filter((s): s is CurveState => Boolean(s));
  const grads = graduations.slice(0, GRADUATED);

  const meta = await getTokenMeta([
    ...newest.map((s) => s.launch.token),
    ...graduating.map((s) => s.launch.token),
    ...hot.map((s) => s.launch.token),
    ...grads.map((g) => g.token),
  ]).catch(() => new Map());

  const card = (s: CurveState): TrenchCard => {
    const m = meta.get(s.launch.token.toLowerCase());
    return {
      token: s.launch.token,
      curve: s.launch.curve,
      symbol: m?.symbol ?? `${s.launch.token.slice(0, 6)}…`,
      name: m?.name ?? "",
      deployer: s.launch.deployer,
      launchedAt: blockTime(clock, s.launch.block),
      quoteSymbol: s.quote.symbol,
      priceUsd: s.priceUsd,
      raisedUsd: s.raisedUsd,
      thresholdUsd: s.thresholdUsd,
      progressPct: Number((s.progress * 100).toFixed(2)),
      flow: flowOf(s.launch.curve),
      url: ponsTokenUrl(s.launch.token),
    };
  };

  const launchByToken = new Map(launches.map((l) => [l.token.toLowerCase(), l]));
  const graduated: GraduatedCard[] = grads.map((g) => {
    const m = meta.get(g.token.toLowerCase());
    const launch = launchByToken.get(g.token.toLowerCase());
    const quote = launch ? quoteOf(launch.pairToken, book) : null;
    return {
      token: g.token,
      symbol: m?.symbol ?? `${g.token.slice(0, 6)}…`,
      name: m?.name ?? "",
      graduatedAt: blockTime(clock, g.block),
      // Both sides of the seeded pool are worth about the same at graduation.
      liquidityUsd: quote ? unitsToNumber(g.pairTokenAmount, quote.decimals) * quote.usd * 2 : null,
      quoteSymbol: quote?.symbol ?? "",
      tx: g.tx,
      url: ponsTokenUrl(g.token),
    };
  });

  return {
    headTime: clock.headTime,
    windowMinutes: FLOW_WINDOW_SECONDS / 60,
    stats: statsOf(clock, launches, graduations, flows),
    newest: newest.map(card),
    graduating: graduating.map(card),
    hot: hot.map(card),
    graduated,
  };
}

function statsOf(
  clock: BlockClock,
  launches: PonsLaunch[],
  graduations: { block: bigint }[],
  flows: Map<string, CurveFlow>,
): TrenchesSnapshot["stats"] {
  const hourAgo = clock.head - blocksFor(3600);
  const dayAgo = clock.head - blocksFor(86_400);
  let buyUsd = 0;
  let sellUsd = 0;
  let curveTrades = 0;
  for (const f of flows.values()) {
    buyUsd += f.buyUsd;
    sellUsd += f.sellUsd;
    curveTrades += f.trades;
  }
  return {
    launchesLastHour: launches.filter((l) => l.block >= hourAgo).length,
    graduationsLastDay: graduations.filter((g) => g.block >= dayAgo).length,
    curveTrades,
    buyUsd,
    sellUsd,
    activeCurves: flows.size,
  };
}

/** Live view of the Pons launchpad: what just launched, what is about to graduate, what is being traded. */
export async function getTrenches(provider: RobinhoodChainProvider): Promise<TrenchesSnapshot> {
  return cache.get("radar:trenches", TRENCHES_TTL, () => build(provider), { swr: true });
}
