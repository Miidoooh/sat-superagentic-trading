import { fmtUsd } from "../format";
import type { TrenchesSnapshot } from "../radar/trenches";
import type { RadarSnapshot } from "../radar/whales";

/** Shared by the browser alert center and the background worker. */

export interface AlertSettings {
  enabled: boolean;
  whaleUsd: number;
  graduationPct: number;
  followed: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { enabled: false, whaleUsd: 10_000, graduationPct: 90, followed: true };

export interface AlertItem {
  id: string;
  kind: "whale" | "graduation" | "follow" | "launch" | "rule" | "social";
  title: string;
  body: string;
  token?: string;
  wallet?: string;
  url?: string;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Trade sizes the UI offers; the worker keeps a radar snapshot warm for each. */
export const RADAR_SIZES = [250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 100_000] as const;

/** The largest warm radar size that still includes every trade of at least minUsd. */
export function snapRadarSize(minUsd: number): number {
  let best: number = RADAR_SIZES[0];
  for (const s of RADAR_SIZES) if (s <= minUsd) best = s;
  return best;
}

/** Turn fresh radar and trenches payloads into alerts, skipping anything already seen. */
export function detectAlerts(
  radar: RadarSnapshot | null,
  trenches: TrenchesSnapshot | null,
  settings: AlertSettings,
  followed: Set<string>,
  seen: Set<string>,
): AlertItem[] {
  const out: AlertItem[] = [];
  const push = (a: AlertItem) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push(a);
  };
  for (const t of radar?.trades ?? []) {
    const byFollowed = settings.followed && t.trader !== null && followed.has(t.trader.toLowerCase());
    if (byFollowed) {
      push({
        id: `follow:${t.id}`,
        kind: "follow",
        title: `${shortAddr(t.trader!)} ${t.side === "buy" ? "bought" : "sold"} ${t.symbol}`,
        body: `${fmtUsd(t.usd, { compact: true })} on ${t.venue === "pons" ? "Pons" : "Uniswap"}`,
        token: t.token,
        wallet: t.trader!,
      });
    } else if (t.usd >= settings.whaleUsd) {
      push({
        id: `whale:${t.id}`,
        kind: "whale",
        title: `Whale ${t.side} · ${t.symbol}`,
        body: `${fmtUsd(t.usd, { compact: true })}${t.trader ? ` by ${shortAddr(t.trader)}` : ""}`,
        token: t.token,
        wallet: t.trader ?? undefined,
      });
    }
  }
  for (const c of trenches?.graduating ?? []) {
    if (c.progressPct < settings.graduationPct) continue;
    push({
      id: `grad:${c.curve}:${settings.graduationPct}`,
      kind: "graduation",
      title: `${c.symbol} is ${c.progressPct.toFixed(0)}% to graduation`,
      body: `${fmtUsd(c.raisedUsd, { compact: true })} of ${fmtUsd(c.thresholdUsd, { compact: true })} raised on its Pons curve`,
      token: c.token,
      url: c.url,
    });
  }
  if (settings.followed) {
    for (const c of trenches?.newest ?? []) {
      if (!followed.has(c.deployer.toLowerCase())) continue;
      push({
        id: `launch:${c.curve}`,
        kind: "launch",
        title: `${shortAddr(c.deployer)} launched ${c.symbol}`,
        body: "New Pons launch from a wallet you follow",
        token: c.token,
        wallet: c.deployer,
        url: c.url,
      });
    }
  }
  return out;
}
