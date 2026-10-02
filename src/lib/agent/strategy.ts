import { z } from "zod";
import { fmtUsd } from "../format";
import type { PonsSocials } from "../data/ponsProfile";

/**
 * A trading style: which tokens to buy, how much, and when to sell them.
 * Styles only ever produce picks and exit signals. The user signs every trade.
 */

export const STYLES = ["sniper", "momentum", "graduation", "whale", "custom"] as const;
export type Style = (typeof STYLES)[number];

export const TakeProfitSchema = z.object({
  /** Sell when the market cap is this many times the entry. */
  atX: z.number().min(1.05).max(1000),
  /** Percent of the original position to sell there. */
  sellPct: z.number().min(1).max(100),
});

export const StrategySchema = z.object({
  name: z.string().trim().min(1).max(40),
  style: z.enum(STYLES),
  /** curve = still on its Pons bonding curve; graduated = trading in a Uniswap v4 pool. */
  stage: z.enum(["curve", "graduated", "any"]).default("curve"),
  mcapMin: z.number().min(0).max(1e10).default(0),
  mcapMax: z.number().min(0).max(1e12).optional(),
  maxAgeMin: z.number().min(1).max(60 * 24 * 90).optional(),
  minProgressPct: z.number().min(0).max(100).optional(),
  maxProgressPct: z.number().min(0).max(100).optional(),
  minVol30mUsd: z.number().min(0).max(1e10).default(0),
  minNet30mUsd: z.number().min(-1e10).max(1e10).optional(),
  minBuyers30m: z.number().int().min(0).max(1e6).default(0),
  requireSocials: z.boolean().default(false),
  minSafety: z.number().min(0).max(100).optional(),
  buyUsd: z.number().min(1).max(100_000).default(10),
  takeProfits: z.array(TakeProfitSchema).min(1).max(4),
  /** Sell everything after falling this many percent below the entry. */
  stopLossPct: z.number().min(1).max(99),
  /** Once in profit, sell everything after falling this many percent from the peak. */
  trailingPct: z.number().min(1).max(99).optional(),
  maxHoldHours: z.number().min(0.1).max(24 * 90).optional(),
});

export type Strategy = z.infer<typeof StrategySchema>;

export const STYLE_PRESETS: Record<Exclude<Style, "custom">, Strategy> = {
  sniper: {
    name: "Sniper",
    style: "sniper",
    stage: "curve",
    mcapMin: 3_000,
    mcapMax: 15_000,
    maxAgeMin: 20,
    minVol30mUsd: 300,
    minNet30mUsd: 100,
    minBuyers30m: 8,
    requireSocials: true,
    buyUsd: 10,
    takeProfits: [
      { atX: 2, sellPct: 50 },
      { atX: 5, sellPct: 50 },
    ],
    stopLossPct: 40,
    maxHoldHours: 6,
  },
  momentum: {
    name: "Momentum",
    style: "momentum",
    stage: "any",
    mcapMin: 10_000,
    mcapMax: 250_000,
    minVol30mUsd: 5_000,
    minNet30mUsd: 1_000,
    minBuyers30m: 25,
    requireSocials: false,
    buyUsd: 25,
    takeProfits: [
      { atX: 1.5, sellPct: 50 },
      { atX: 3, sellPct: 50 },
    ],
    stopLossPct: 25,
    trailingPct: 20,
  },
  graduation: {
    name: "Graduation play",
    style: "graduation",
    stage: "curve",
    mcapMin: 0,
    minProgressPct: 60,
    maxProgressPct: 99,
    minVol30mUsd: 200,
    minNet30mUsd: 0,
    minBuyers30m: 3,
    requireSocials: false,
    minSafety: 60,
    buyUsd: 25,
    takeProfits: [
      { atX: 2, sellPct: 50 },
      { atX: 4, sellPct: 50 },
    ],
    stopLossPct: 30,
  },
  whale: {
    name: "Whale shadow",
    style: "whale",
    stage: "any",
    mcapMin: 5_000,
    mcapMax: 1_000_000,
    minVol30mUsd: 3_000,
    minNet30mUsd: 3_000,
    minBuyers30m: 10,
    requireSocials: false,
    minSafety: 50,
    buyUsd: 25,
    takeProfits: [
      { atX: 2, sellPct: 50 },
      { atX: 4, sellPct: 50 },
    ],
    stopLossPct: 30,
    trailingPct: 25,
  },
};

/** The token facts a style is checked against: one Explore row. */
export interface Candidate {
  token: `0x${string}`;
  symbol: string;
  name: string;
  logoUrl?: string;
  socials?: PonsSocials;
  launchedAt: number | null;
  graduatedAt: number | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  progressPct: number;
  vol30mUsd: number;
  net30mUsd: number;
  traders30m: number;
  url: string;
  paySymbol?: string;
  payUsd?: number;
}

export interface PlanLevel {
  atX: number;
  sellPct: number;
  mcap: number;
  price: number;
}

export interface PickPlan {
  buyUsd: number;
  entryMcap: number;
  entryPrice: number;
  targets: PlanLevel[];
  stop: { pct: number; mcap: number; price: number };
  trailingPct?: number;
  maxHoldHours?: number;
}

export interface Pick {
  token: `0x${string}`;
  symbol: string;
  name: string;
  logoUrl?: string;
  socials?: PonsSocials;
  stage: "curve" | "graduated";
  mcapUsd: number;
  priceUsd: number;
  ageMin: number | null;
  progressPct: number;
  vol30mUsd: number;
  net30mUsd: number;
  buyers30m: number;
  safety?: { score: number; label: string };
  /** 0 to 100: how strongly the token fits the style right now. */
  score: number;
  reasons: string[];
  /** Red flags worth a second look, such as a copied ticker. */
  warnings: string[];
  plan: PickPlan;
  url: string;
  /** What a buy pays with, and its USD price. */
  paySymbol: string;
  payUsd: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const money = (n: number) => fmtUsd(n, { compact: true });
const hasSocials = (s?: PonsSocials) => !!s && Object.values(s).some(Boolean);

/** Entry, targets and stop for a buy at the current market cap. */
export function planFor(s: Strategy, mcap: number, price: number): PickPlan {
  return {
    buyUsd: s.buyUsd,
    entryMcap: mcap,
    entryPrice: price,
    targets: [...s.takeProfits].sort((a, b) => a.atX - b.atX).map((t) => ({ ...t, mcap: mcap * t.atX, price: price * t.atX })),
    stop: { pct: s.stopLossPct, mcap: mcap * (1 - s.stopLossPct / 100), price: price * (1 - s.stopLossPct / 100) },
    trailingPct: s.trailingPct,
    maxHoldHours: s.maxHoldHours,
  };
}

/** The plan in one sentence. */
export function describePlan(p: PickPlan): string {
  const targets = p.targets.map((t) => `${t.sellPct}% at ${money(t.mcap)} (${t.atX}×)`).join(", ");
  const trail = p.trailingPct ? `, trail ${p.trailingPct}% from the top` : "";
  const hold = p.maxHoldHours ? `, out within ${p.maxHoldHours}h` : "";
  return `Buy ${money(p.buyUsd)} at ${money(p.entryMcap)} mcap. Sell ${targets}. Stop at ${money(p.stop.mcap)} (−${p.stop.pct}%)${trail}${hold}.`;
}

/** Why a candidate fails the style, or null when it passes. Safety is checked separately (it costs RPC reads). */
export function rejectReason(s: Strategy, c: Candidate, now: number): string | null {
  const graduated = c.graduatedAt !== null;
  if (s.stage === "curve" && graduated) return "graduated";
  if (s.stage === "graduated" && !graduated) return "still on curve";
  if (c.mcapUsd === null || c.priceUsd === null || c.mcapUsd <= 0) return "no price";
  if (c.mcapUsd < s.mcapMin) return "mcap too low";
  if (s.mcapMax !== undefined && c.mcapUsd > s.mcapMax) return "mcap too high";
  if (s.maxAgeMin !== undefined) {
    if (c.launchedAt === null) return "unknown age";
    if ((now - c.launchedAt) / 60 > s.maxAgeMin) return "too old";
  }
  if (!graduated && s.minProgressPct !== undefined && c.progressPct < s.minProgressPct) return "not bonded enough";
  if (!graduated && s.maxProgressPct !== undefined && c.progressPct > s.maxProgressPct) return "bonded too far";
  if (c.vol30mUsd < s.minVol30mUsd) return "low volume";
  if (s.minNet30mUsd !== undefined && c.net30mUsd < s.minNet30mUsd) return "not enough net buying";
  if (c.traders30m < s.minBuyers30m) return "too few traders";
  if (s.requireSocials && !hasSocials(c.socials)) return "no socials";
  return null;
}

/** How strongly a passing candidate fits, 0 to 100. */
export function fitScore(s: Strategy, c: Candidate, now: number, safety?: number): number {
  const ageMin = c.launchedAt !== null ? (now - c.launchedAt) / 60 : null;
  const flow = clamp01(Math.log10(1 + Math.max(0, c.net30mUsd)) / 4);
  const crowd = clamp01(c.traders30m / 60);
  const volume = clamp01(Math.log10(1 + c.vol30mUsd) / 4.5);
  const timing =
    s.style === "sniper"
      ? ageMin === null
        ? 0
        : clamp01(1 - ageMin / Math.max(5, s.maxAgeMin ?? 60))
      : s.style === "graduation"
        ? clamp01(c.progressPct / 100)
        : ageMin === null
          ? 0.5
          : clamp01(1 - ageMin / (60 * 24));
  const safe = safety === undefined ? 0.5 : safety / 100;
  return Math.round(30 * flow + 25 * crowd + 20 * volume + 15 * timing + 10 * safe);
}

function reasonsFor(s: Strategy, c: Candidate, now: number, safety?: { score: number; label: string }): string[] {
  const out: string[] = [];
  const range = s.mcapMax !== undefined ? `${money(s.mcapMin)}–${money(s.mcapMax)}` : `${money(s.mcapMin)}+`;
  out.push(`${money(c.mcapUsd ?? 0)} mcap, inside your ${range}`);
  if (c.launchedAt !== null) {
    const mins = Math.max(0, Math.round((now - c.launchedAt) / 60));
    out.push(mins < 120 ? `launched ${mins}m ago` : `launched ${Math.round(mins / 60)}h ago`);
  }
  if (c.traders30m) out.push(`${c.traders30m} wallets traded it in 30m`);
  if (c.net30mUsd > 0) out.push(`${money(c.net30mUsd)} net buying in 30m`);
  if (c.vol30mUsd) out.push(`${money(c.vol30mUsd)} volume in 30m`);
  if (c.graduatedAt === null) out.push(`${c.progressPct.toFixed(0)}% bonded`);
  else out.push("graduated to Uniswap v4");
  if (hasSocials(c.socials)) out.push("lists its socials");
  if (safety) out.push(`safety ${safety.score} · ${safety.label}`);
  return out;
}

/** Candidates that pass the style, best fit first, each with a plan. */
export function matchPicks(
  s: Strategy,
  candidates: Candidate[],
  now: number,
  opts: { limit?: number; safety?: Map<string, { score: number; label: string }> } = {},
): Pick[] {
  const picks: Pick[] = [];
  for (const c of candidates) {
    if (rejectReason(s, c, now)) continue;
    const safety = opts.safety?.get(c.token.toLowerCase());
    if (s.minSafety !== undefined && opts.safety && (!safety || safety.score < s.minSafety)) continue;
    const mcap = c.mcapUsd!;
    const price = c.priceUsd!;
    picks.push({
      token: c.token,
      symbol: c.symbol,
      name: c.name,
      logoUrl: c.logoUrl,
      socials: c.socials,
      stage: c.graduatedAt === null ? "curve" : "graduated",
      mcapUsd: mcap,
      priceUsd: price,
      ageMin: c.launchedAt !== null ? Math.max(0, Math.round((now - c.launchedAt) / 60)) : null,
      progressPct: c.progressPct,
      vol30mUsd: c.vol30mUsd,
      net30mUsd: c.net30mUsd,
      buyers30m: c.traders30m,
      safety,
      score: fitScore(s, c, now, safety?.score),
      reasons: reasonsFor(s, c, now, safety),
      warnings: [],
      plan: planFor(s, mcap, price),
      url: c.url,
      paySymbol: c.paySymbol ?? "ETH",
      payUsd: c.payUsd ?? 0,
    });
  }
  return picks.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8);
}

/** Flag picks whose ticker was already used by an earlier launch. */
export function flagCopycats(picks: Pick[], universe: { token: string; symbol: string; launchedAt: number | null }[]): Pick[] {
  const first = new Map<string, { token: string; launchedAt: number }>();
  for (const r of universe) {
    if (r.launchedAt === null) continue;
    const key = r.symbol.trim().toLowerCase();
    const seen = first.get(key);
    if (!seen || r.launchedAt < seen.launchedAt) first.set(key, { token: r.token.toLowerCase(), launchedAt: r.launchedAt });
  }
  return picks.map((p) => {
    const orig = first.get(p.symbol.trim().toLowerCase());
    if (!orig || orig.token === p.token.toLowerCase()) return p;
    return { ...p, warnings: [...p.warnings, `Copycat ticker: another ${p.symbol} launched earlier. Check the contract address.`] };
  });
}

/** A position opened from a pick, tracked against its plan. */
export interface TrackedPosition {
  token: `0x${string}`;
  symbol: string;
  openedAt: number;
  plan: PickPlan;
  /** Indexes of plan.targets already signalled. */
  hit: number[];
  peakMcap: number;
}

export interface ExitSignal {
  kind: "take-profit" | "stop-loss" | "trailing" | "time";
  sellPct: number;
  /** Index into plan.targets for take-profit signals. */
  target?: number;
  reason: string;
}

/**
 * What the plan says to do at this market cap, if anything. Take-profits fire
 * once each; a stop, trail or time exit sells whatever is left.
 */
export function checkExit(p: TrackedPosition, mcap: number, now: number): ExitSignal | null {
  const remaining = 100 - p.plan.targets.reduce((sum, t, i) => sum + (p.hit.includes(i) ? t.sellPct : 0), 0);
  if (remaining <= 0) return null;
  const x = mcap / p.plan.entryMcap;
  if (mcap <= p.plan.stop.mcap) {
    return { kind: "stop-loss", sellPct: remaining, reason: `${p.symbol} fell to ${money(mcap)} mcap, past your stop at ${money(p.plan.stop.mcap)} (−${p.plan.stop.pct}%).` };
  }
  for (const [i, t] of p.plan.targets.entries()) {
    if (p.hit.includes(i) || x < t.atX) continue;
    return { kind: "take-profit", sellPct: Math.min(t.sellPct, remaining), target: i, reason: `${p.symbol} hit ${t.atX}× (${money(mcap)} mcap). Your plan: sell ${t.sellPct}%.` };
  }
  const peak = Math.max(p.peakMcap, mcap);
  if (p.plan.trailingPct && peak > p.plan.entryMcap && mcap <= peak * (1 - p.plan.trailingPct / 100)) {
    return { kind: "trailing", sellPct: remaining, reason: `${p.symbol} dropped ${p.plan.trailingPct}% from its ${money(peak)} peak. Your trailing stop says sell the rest.` };
  }
  if (p.plan.maxHoldHours && now - p.openedAt >= p.plan.maxHoldHours * 3600) {
    return { kind: "time", sellPct: remaining, reason: `${p.symbol} has been held ${p.plan.maxHoldHours}h, your time limit. Sell the rest at ${x.toFixed(2)}×.` };
  }
  return null;
}
