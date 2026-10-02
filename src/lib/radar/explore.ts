import { cache } from "../cache";
import { blockClock, blockTime } from "../chain/logs";
import { ponsTokenUrl } from "../chain/constants";
import { listLaunches, quoteOf, recentGraduations, scanCurves, type CurveState, type PonsLaunch } from "../data/pons";
import { recentCurveTrades, type RawCurveTrade } from "../data/ponsFlow";
import { getPonsProfiles, type PonsSocials } from "../data/ponsProfile";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { getTokenMeta } from "../data/tokenMeta";
import { flowByCurve } from "./trenches";
import { unitsToNumber } from "./whales";

/**
 * The Pons explorer: every live curve SAT scans (the newest few thousand),
 * plus the last day of graduations, as one sortable, filterable table.
 */

export type ExploreTab = "new" | "trending" | "almost" | "graduated";
export type ExploreSort = "age" | "mcap" | "volume" | "progress" | "txns" | "net";

/** Every Pons launch mints one billion tokens. */
const SUPPLY = 1_000_000_000;
const BASE_TTL = 12 * 1000;
export const EXPLORE_PAGE = 50;

export interface ExploreRow {
  token: `0x${string}`;
  curve: `0x${string}` | null;
  symbol: string;
  name: string;
  logoUrl?: string;
  socials?: PonsSocials;
  deployer: `0x${string}` | null;
  launchedAt: number | null;
  graduatedAt: number | null;
  quoteSymbol: string;
  /** What a buy pays with, and its USD price: the curve's quote asset, or ETH once graduated. */
  paySymbol: string;
  payUsd: number;
  priceUsd: number | null;
  mcapUsd: number | null;
  raisedUsd: number;
  progressPct: number;
  vol30mUsd: number;
  net30mUsd: number;
  txns30m: number;
  traders30m: number;
  url: string;
}

export interface ExploreQuery {
  tab: ExploreTab;
  sort?: ExploreSort;
  q?: string;
  minMcap?: number;
  minVol?: number;
  socials?: boolean;
  offset?: number;
  limit?: number;
}

export interface ExplorePage {
  tab: ExploreTab;
  counts: Record<ExploreTab, number>;
  total: number;
  rows: ExploreRow[];
  scanned: number;
  updatedAt: number;
}

interface Base {
  curves: Omit<ExploreRow, "logoUrl" | "socials">[];
  graduated: Omit<ExploreRow, "logoUrl" | "socials">[];
  updatedAt: number;
}

async function buildBase(provider: RobinhoodChainProvider): Promise<Base> {
  const [clock, book] = await Promise.all([blockClock(), provider.quoteBook()]);
  const [launches, scan, trades, graduations] = await Promise.all([
    listLaunches().catch(() => [] as PonsLaunch[]),
    scanCurves(book).catch(() => [] as CurveState[]),
    recentCurveTrades().catch(() => [] as RawCurveTrade[]),
    recentGraduations().catch(() => []),
  ]);
  const flows = flowByCurve(trades, launches, book);
  const meta = await getTokenMeta([...scan.map((s) => s.launch.token), ...graduations.map((g) => g.token)]).catch(() => new Map());
  const launchByToken = new Map(launches.map((l) => [l.token.toLowerCase(), l]));

  const curves = scan.map((s) => {
    const m = meta.get(s.launch.token.toLowerCase());
    const f = flows.get(s.launch.curve.toLowerCase());
    return {
      token: s.launch.token,
      curve: s.launch.curve,
      symbol: m?.symbol ?? `${s.launch.token.slice(0, 6)}…`,
      name: m?.name ?? "",
      deployer: s.launch.deployer,
      launchedAt: blockTime(clock, s.launch.block),
      graduatedAt: null,
      quoteSymbol: s.quote.symbol,
      paySymbol: s.quote.symbol,
      payUsd: s.quote.usd,
      priceUsd: s.priceUsd,
      mcapUsd: s.priceUsd * SUPPLY,
      raisedUsd: s.raisedUsd,
      progressPct: Number((s.progress * 100).toFixed(2)),
      vol30mUsd: f ? f.buyUsd + f.sellUsd : 0,
      net30mUsd: f ? f.buyUsd - f.sellUsd : 0,
      txns30m: f?.trades ?? 0,
      traders30m: f?.traders ?? 0,
      url: ponsTokenUrl(s.launch.token),
    };
  });

  const graduated = graduations.map((g) => {
    const m = meta.get(g.token.toLowerCase());
    const launch = launchByToken.get(g.token.toLowerCase());
    const quote = launch ? quoteOf(launch.pairToken, book) : null;
    const seedUsd = quote ? unitsToNumber(g.pairTokenAmount, quote.decimals) * quote.usd : 0;
    // At graduation the pool is seeded at the curve's final price.
    const priceUsd = quote && g.tokenAmount > 0n ? seedUsd / unitsToNumber(g.tokenAmount, 18) : null;
    return {
      token: g.token,
      curve: launch?.curve ?? null,
      symbol: m?.symbol ?? `${g.token.slice(0, 6)}…`,
      name: m?.name ?? "",
      deployer: launch?.deployer ?? null,
      launchedAt: launch ? blockTime(clock, launch.block) : null,
      graduatedAt: blockTime(clock, g.block),
      quoteSymbol: quote?.symbol ?? "",
      paySymbol: "ETH",
      payUsd: book.ethUsd,
      priceUsd,
      mcapUsd: priceUsd !== null ? priceUsd * SUPPLY : null,
      raisedUsd: seedUsd,
      progressPct: 100,
      vol30mUsd: 0,
      net30mUsd: 0,
      txns30m: 0,
      traders30m: 0,
      url: ponsTokenUrl(g.token),
    };
  });

  return { curves, graduated, updatedAt: Date.now() };
}

async function base(provider: RobinhoodChainProvider): Promise<Base> {
  return cache.get("explore:base:v2", BASE_TTL, () => buildBase(provider), { swr: true });
}

/** Every scanned launch, curves and graduated, without logos or socials. */
export async function exploreUniverse(provider: RobinhoodChainProvider): Promise<{ rows: Base["curves"]; scanned: number; updatedAt: number }> {
  const b = await base(provider);
  return { rows: [...b.curves, ...b.graduated], scanned: b.curves.length, updatedAt: b.updatedAt };
}

const DEFAULT_SORT: Record<ExploreTab, ExploreSort> = { new: "age", trending: "volume", almost: "progress", graduated: "age" };

function sortKey(row: Base["curves"][number], sort: ExploreSort, tab: ExploreTab): number {
  switch (sort) {
    case "age":
      return tab === "graduated" ? (row.graduatedAt ?? 0) : (row.launchedAt ?? 0);
    case "mcap":
      return row.mcapUsd ?? 0;
    case "volume":
      return row.vol30mUsd;
    case "progress":
      return row.progressPct;
    case "txns":
      return row.txns30m;
    case "net":
      return row.net30mUsd;
  }
}

/** Filter, sort and page the table, then attach logos and socials to the rows shown. */
export async function explore(provider: RobinhoodChainProvider, query: ExploreQuery): Promise<ExplorePage> {
  const b = await base(provider);
  const almost = b.curves.filter((r) => r.progressPct < 100 && r.raisedUsd > 0);
  const trending = b.curves.filter((r) => r.txns30m > 0);
  const pools: Record<ExploreTab, Base["curves"]> = { new: b.curves, trending, almost, graduated: b.graduated };

  const q = query.q?.trim().toLowerCase().replace(/^\$/, "");
  const sort = query.sort ?? DEFAULT_SORT[query.tab];
  let rows = pools[query.tab].filter((r) => {
    if (q && !r.symbol.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && r.token.toLowerCase() !== q) return false;
    if (query.minMcap && (r.mcapUsd ?? 0) < query.minMcap) return false;
    if (query.minVol && r.vol30mUsd < query.minVol) return false;
    return true;
  });
  rows = [...rows].sort((x, y) => sortKey(y, sort, query.tab) - sortKey(x, sort, query.tab));

  // Socials live on chain per token; read them for the filter only when asked, and for the page always.
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(300, Math.max(1, query.limit ?? EXPLORE_PAGE));
  let candidates = rows;
  if (query.socials) {
    const window = rows.slice(0, offset + limit * 4);
    const profiles = await getPonsProfiles(window.map((r) => r.token)).catch(() => new Map());
    candidates = window.filter((r) => {
      const s = profiles.get(r.token.toLowerCase())?.socials;
      return !!s && Object.values(s).some(Boolean);
    });
  }
  const page = candidates.slice(offset, offset + limit);
  const profiles = await getPonsProfiles(page.map((r) => r.token)).catch(() => new Map());

  return {
    tab: query.tab,
    counts: { new: b.curves.length, trending: trending.length, almost: almost.length, graduated: b.graduated.length },
    total: query.socials ? candidates.length : rows.length,
    rows: page.map((r) => {
      const p = profiles.get(r.token.toLowerCase());
      return { ...r, logoUrl: p?.logoUrl ?? undefined, socials: p?.socials };
    }),
    scanned: b.curves.length,
    updatedAt: b.updatedAt,
  };
}
