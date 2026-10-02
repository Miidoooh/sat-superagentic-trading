import { getKv } from "../store/kv";
import type { Pick, Style } from "./strategy";

/**
 * Paper track record for each preset style: every pick is logged at the
 * market cap it was first suggested, then marked against later scans. Nothing
 * is traded; this only shows how a style's calls played out.
 */

const KEY = (style: Style) => `agent:track:v1:${style}`;
const WINDOW_S = 24 * 3600;
const KEEP_S = 72 * 3600;
const MAX_ENTRIES = 400;

export interface TrackEntry {
  token: `0x${string}`;
  symbol: string;
  at: number;
  entryMcap: number;
  peakMcap: number;
  lastMcap: number;
}

export interface TrackStats {
  style: Style;
  picks: number;
  hit2x: number;
  hit5x: number;
  /** Share of picks whose peak reached at least 1.5x. */
  winRatePct: number;
  best: { symbol: string; token: `0x${string}`; x: number } | null;
  medianPeakX: number | null;
  windowHours: number;
}

/** Add new picks and mark every open entry at the latest market caps. */
export function mergeTrack(entries: TrackEntry[], picks: Pick[], marks: Map<string, number>, now: number): TrackEntry[] {
  const live = entries.filter((e) => now - e.at <= KEEP_S);
  const recent = new Set(live.filter((e) => now - e.at <= WINDOW_S).map((e) => e.token.toLowerCase()));
  for (const p of picks) {
    if (recent.has(p.token.toLowerCase())) continue;
    recent.add(p.token.toLowerCase());
    live.push({ token: p.token, symbol: p.symbol, at: now, entryMcap: p.mcapUsd, peakMcap: p.mcapUsd, lastMcap: p.mcapUsd });
  }
  for (const e of live) {
    const m = marks.get(e.token.toLowerCase());
    if (m === undefined || m <= 0) continue;
    e.lastMcap = m;
    if (m > e.peakMcap) e.peakMcap = m;
  }
  return live.slice(-MAX_ENTRIES);
}

export function trackStats(style: Style, entries: TrackEntry[], now: number): TrackStats {
  const day = entries.filter((e) => now - e.at <= WINDOW_S && e.entryMcap > 0);
  const peaks = day.map((e) => ({ e, x: e.peakMcap / e.entryMcap })).sort((a, b) => a.x - b.x);
  const best = peaks.at(-1);
  return {
    style,
    picks: day.length,
    hit2x: peaks.filter((p) => p.x >= 2).length,
    hit5x: peaks.filter((p) => p.x >= 5).length,
    winRatePct: day.length ? Math.round((peaks.filter((p) => p.x >= 1.5).length / day.length) * 100) : 0,
    best: best && best.x > 1 ? { symbol: best.e.symbol, token: best.e.token, x: Number(best.x.toFixed(2)) } : null,
    medianPeakX: peaks.length ? Number(peaks[Math.floor(peaks.length / 2)].x.toFixed(2)) : null,
    windowHours: 24,
  };
}

export async function recordPicks(style: Style, picks: Pick[], marks: Map<string, number>): Promise<TrackStats> {
  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);
  const merged = mergeTrack((await kv.get<TrackEntry[]>(KEY(style))) ?? [], picks, marks, now);
  await kv.set(KEY(style), merged, (KEEP_S + 3600) * 1000);
  return trackStats(style, merged, now);
}

export async function readTrack(style: Style): Promise<TrackStats> {
  const now = Math.floor(Date.now() / 1000);
  return trackStats(style, (await getKv().get<TrackEntry[]>(KEY(style))) ?? [], now);
}
