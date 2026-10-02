import { getConfig } from "../config";
import { getKv } from "../store/kv";

/** twitterapi.io: a pay-per-result reader for public X data. */
const BASE = "https://api.twitterapi.io";
const TIMEOUT_MS = 12_000;

export interface RawTweet {
  id: string;
  url?: string;
  text?: string;
  createdAt?: string;
  likeCount?: number;
  retweetCount?: number;
  viewCount?: number;
  isReply?: boolean;
  author?: {
    userName?: string;
    name?: string;
    followers?: number;
    isBlueVerified?: boolean;
    profilePicture?: string;
  };
}

const budgetKey = () => `social:calls:${new Date().toISOString().slice(0, 10)}`;

/** Calls made today, shared across instances when Redis is configured. */
export async function callsToday(): Promise<number> {
  return (await getKv().get<number>(budgetKey()).catch(() => null)) ?? 0;
}

async function spend(): Promise<boolean> {
  const cfg = getConfig();
  const used = await callsToday();
  if (used >= cfg.SOCIAL_MAX_CALLS_PER_DAY) return false;
  await getKv().set(budgetKey(), used + 1, 26 * 3600_000);
  return true;
}

/** One page of the newest tweets matching an X advanced-search query, or null when off or over budget. */
export async function searchLatest(query: string): Promise<RawTweet[] | null> {
  const key = getConfig().TWITTERAPI_IO_KEY;
  if (!key || !(await spend())) return null;
  const url = `${BASE}/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`X search failed (${res.status})`);
  const body = (await res.json()) as { tweets?: RawTweet[] };
  return body.tweets ?? [];
}
