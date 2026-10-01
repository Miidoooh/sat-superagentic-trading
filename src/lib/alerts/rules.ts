import { z } from "zod";
import { fmtPct, fmtPrice, fmtUsd } from "../format";
import type { TrenchCard, TrenchesSnapshot } from "../radar/trenches";
import type { RadarSnapshot } from "../radar/whales";
import type { TokenMarket } from "../types";
import { shortAddr, snapRadarSize, type AlertItem, type AlertSettings } from "./detect";

/**
 * Autopilot rules: alerts a user describes in plain words, stored as explicit
 * conditions so they can be checked every poll by the browser or the worker.
 * Rules only ever alert. Nothing here can place a trade.
 */

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const RuleSchema = z
  .object({
    id: z.string().min(1).max(40),
    /** The user's own words. */
    text: z.string().max(300).default(""),
    enabled: z.boolean().default(true),
    kind: z.enum(["trade", "curve", "launch", "price"]),
    token: addr.optional(),
    tokenSymbol: z.string().max(32).optional(),
    side: z.enum(["buy", "sell"]).optional(),
    venue: z.enum(["stock", "pons"]).optional(),
    /** trade: minimum trade size */
    minUsd: z.number().min(0).max(1e9).optional(),
    /** trade: made by this wallet. launch: deployed by this wallet. */
    wallet: addr.optional(),
    /** curve: at least this far to graduation */
    progressPct: z.number().min(1).max(100).optional(),
    /** Net buying on the token in the last 30 minutes, "whales are buying". */
    netFlowUsd: z.number().min(0).max(1e9).optional(),
    priceAbove: z.number().positive().optional(),
    priceBelow: z.number().positive().optional(),
    /** price: absolute 1h move of at least this many percent */
    change1hPct: z.number().positive().max(1000).optional(),
  })
  .refine((r) => r.kind !== "price" || r.token, { message: "Price rules need a specific token" })
  .refine((r) => r.kind !== "price" || r.priceAbove || r.priceBelow || r.change1hPct, {
    message: "Price rules need a price level or a percent move",
  });

export type Rule = z.infer<typeof RuleSchema>;
export const RuleListSchema = z.array(RuleSchema).max(30);

export interface RuleContext {
  radar: RadarSnapshot | null;
  trenches: TrenchesSnapshot | null;
  markets: TokenMarket[] | null;
}

/** Price rules fire once when they become true and re-arm when they stop being true. */
export interface RuleState {
  seen: Set<string>;
  active: Set<string>;
}

export const newRuleState = (): RuleState => ({ seen: new Set(), active: new Set() });

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Net 30-minute inflow for a token, from the radar's flow tables. */
function netFlow(radar: RadarSnapshot | null, token: string): number {
  const row = [...(radar?.inflows ?? []), ...(radar?.outflows ?? [])].find((f) => same(f.token, token));
  return row?.netUsd ?? 0;
}

function curveNet(card: TrenchCard): number {
  return card.flow.buyUsd - card.flow.sellUsd;
}

/** One-line description of what a rule watches for. */
export function describeRule(rule: Rule): string {
  const who = rule.tokenSymbol ?? (rule.token ? shortAddr(rule.token) : rule.venue === "pons" ? "any Pons launch" : rule.venue === "stock" ? "any Stock Token" : "any token");
  const flow = rule.netFlowUsd ? ` while net buying is at least ${fmtUsd(rule.netFlowUsd, { compact: true })} in 30m` : "";
  switch (rule.kind) {
    case "trade": {
      const side = rule.side === "buy" ? "buy" : rule.side === "sell" ? "sell" : "trade";
      const size = rule.minUsd ? ` of ${fmtUsd(rule.minUsd, { compact: true })}+` : "";
      const by = rule.wallet ? ` by ${shortAddr(rule.wallet)}` : "";
      return `A ${side}${size} in ${who}${by}${flow}`;
    }
    case "curve":
      return `${rule.tokenSymbol ?? (rule.token ? shortAddr(rule.token) : "Any Pons curve")} reaches ${rule.progressPct ?? 90}% to graduation${flow}`;
    case "launch":
      return rule.wallet ? `${shortAddr(rule.wallet)} launches a new token on Pons` : "Any new Pons launch";
    case "price": {
      const parts: string[] = [];
      if (rule.priceAbove) parts.push(`goes above $${fmtPrice(rule.priceAbove)}`);
      if (rule.priceBelow) parts.push(`goes below $${fmtPrice(rule.priceBelow)}`);
      if (rule.change1hPct) parts.push(`moves ${rule.change1hPct}% or more in an hour`);
      return `${who} ${parts.join(" or ")}`;
    }
  }
}

export function evaluateRules(rules: Rule[], ctx: RuleContext, state: RuleState): AlertItem[] {
  const out: AlertItem[] = [];
  const push = (a: AlertItem) => {
    if (state.seen.has(a.id)) return;
    state.seen.add(a.id);
    out.push(a);
  };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const flowOk = (token: string) => !rule.netFlowUsd || netFlow(ctx.radar, token) >= rule.netFlowUsd;

    if (rule.kind === "trade") {
      for (const t of ctx.radar?.trades ?? []) {
        if (rule.token && !same(t.token, rule.token)) continue;
        if (rule.side && t.side !== rule.side) continue;
        if (rule.venue && t.venue !== rule.venue) continue;
        if (rule.minUsd && t.usd < rule.minUsd) continue;
        if (rule.wallet && !same(t.trader ?? undefined, rule.wallet)) continue;
        if (!flowOk(t.token)) continue;
        push({
          id: `rule:${rule.id}:${t.id}`,
          kind: "rule",
          title: `${t.side === "buy" ? "Buy" : "Sell"} ${t.symbol} · ${fmtUsd(t.usd, { compact: true })}`,
          body: `Your rule: ${rule.text || describeRule(rule)}`,
          token: t.token,
          wallet: t.trader ?? undefined,
        });
      }
    } else if (rule.kind === "curve") {
      const cards = new Map<string, TrenchCard>();
      for (const c of [...(ctx.trenches?.graduating ?? []), ...(ctx.trenches?.hot ?? []), ...(ctx.trenches?.newest ?? [])]) cards.set(c.curve, c);
      const target = rule.progressPct ?? 90;
      for (const c of cards.values()) {
        if (rule.token && !same(c.token, rule.token)) continue;
        if (c.progressPct < target) continue;
        if (rule.netFlowUsd && curveNet(c) < rule.netFlowUsd && netFlow(ctx.radar, c.token) < rule.netFlowUsd) continue;
        push({
          id: `rule:${rule.id}:curve:${c.curve}`,
          kind: "rule",
          title: `${c.symbol} is ${c.progressPct.toFixed(0)}% to graduation`,
          body: `${fmtUsd(c.raisedUsd, { compact: true })} raised · net ${fmtUsd(curveNet(c), { compact: true })} in 30m · ${rule.text || describeRule(rule)}`,
          token: c.token,
          url: c.url,
        });
      }
    } else if (rule.kind === "launch") {
      for (const c of ctx.trenches?.newest ?? []) {
        if (rule.wallet && !same(c.deployer, rule.wallet)) continue;
        push({
          id: `rule:${rule.id}:launch:${c.curve}`,
          kind: "rule",
          title: `New launch: ${c.symbol}`,
          body: `Deployed by ${shortAddr(c.deployer)} · ${rule.text || describeRule(rule)}`,
          token: c.token,
          wallet: c.deployer,
          url: c.url,
        });
      }
    } else if (rule.kind === "price") {
      const m = ctx.markets?.find((x) => same(x.token.address, rule.token));
      if (!m) continue;
      const hits: string[] = [];
      if (rule.priceAbove && m.priceUsd >= rule.priceAbove) hits.push(`above $${fmtPrice(rule.priceAbove)}`);
      if (rule.priceBelow && m.priceUsd <= rule.priceBelow) hits.push(`below $${fmtPrice(rule.priceBelow)}`);
      if (rule.change1hPct && m.priceChange1hPct !== null && Math.abs(m.priceChange1hPct) >= rule.change1hPct) {
        hits.push(`${fmtPct(m.priceChange1hPct)} in 1h`);
      }
      const key = `rule:${rule.id}:price`;
      if (hits.length === 0 || !flowOk(m.token.address)) {
        state.active.delete(key);
        continue;
      }
      if (state.active.has(key)) continue;
      state.active.add(key);
      out.push({
        id: `${key}:${Date.now()}`,
        kind: "rule",
        title: `${m.token.symbol} is ${hits.join(", ")}`,
        body: `Now $${fmtPrice(m.priceUsd)} · ${rule.text || describeRule(rule)}`,
        token: m.token.address,
      });
    }
  }
  return out;
}

/** What the poller needs to fetch so every rule can be checked. */
export function rulesNeed(rules: Rule[]): { minUsd: number | null; wallets: string[]; markets: boolean; trenches: boolean } {
  const active = rules.filter((r) => r.enabled);
  const trade = active.filter((r) => r.kind === "trade");
  return {
    minUsd: trade.length ? Math.min(...trade.map((r) => r.minUsd ?? 1_000)) : null,
    wallets: [...new Set(active.map((r) => r.wallet).filter((w): w is string => !!w))],
    markets: active.some((r) => r.kind === "price"),
    trenches: active.some((r) => r.kind === "curve" || r.kind === "launch"),
  };
}

export interface PollPlan {
  /** A warm radar size (see RADAR_SIZES). */
  minUsd: number;
  wallets: string[];
  markets: boolean;
  trenches: boolean;
}

/** Everything one alert subscriber needs fetched: built-in alerts plus their rules. */
export function planPoll(settings: AlertSettings, follows: string[], rules: Rule[]): PollPlan {
  const need = rulesNeed(rules);
  const wallets = new Set(need.wallets.map((w) => w.toLowerCase()));
  if (settings.followed) for (const f of follows) wallets.add(f.toLowerCase());
  return {
    minUsd: snapRadarSize(Math.min(settings.whaleUsd, need.minUsd ?? Infinity)),
    wallets: [...wallets],
    markets: need.markets,
    trenches: true,
  };
}
