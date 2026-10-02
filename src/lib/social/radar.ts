import { getConfig } from "../config";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { exploreUniverse } from "../radar/explore";
import { getKv } from "../store/kv";
import type { SocialSnapshot, TokenBuzz, XPost } from "./posts";
import { callsToday, searchLatest, type RawTweet } from "./x";

export { buzzLine, socialAlerts, type SocialSnapshot, type TokenBuzz, type XPost } from "./posts";

/**
 * Social radar: who on X is talking about Robinhood Chain tokens. Each scan
 * asks for tweets newer than the last one, so a quiet minute costs almost
 * nothing. Posts are kept for two days.
 */

const STATE_KEY = "social:state:v1";
const KEEP_S = 48 * 3600;
const MAX_POSTS = 400;
/** Contract addresses searched per scan: the hottest launches plus SAT. */
const WATCH_TOKENS = 10;
const ECOSYSTEM = `("robinhood chain" OR #RobinhoodChain OR rhchain OR pons.family OR "on pons")`;

interface State {
  posts: XPost[];
  scannedAt: number;
}

type Known = Map<string, { token: `0x${string}`; symbol: string }>;

const ADDRESS = /0x[a-fA-F0-9]{40}/g;
const CASHTAG = /\$([A-Za-z][A-Za-z0-9]{1,14})\b/g;
/** Tickers too common to map from a cashtag alone. */
const GENERIC = new Set(["btc", "eth", "sol", "usd", "usdc", "usdt", "usdg", "bnb", "xrp", "hood", "nvda", "tsla"]);

/** Parse twitterapi.io's "Tue Dec 10 07:00:30 +0000 2024" into unix seconds. */
const unix = (s?: string) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
};

/** Which known tokens a tweet is about: by contract address, or by cashtag when the ticker is ours. */
export function tokensIn(text: string, byAddress: Known, bySymbol: Known): XPost["tokens"] {
  const out = new Map<string, XPost["tokens"][number]>();
  for (const m of text.match(ADDRESS) ?? []) {
    const hit = byAddress.get(m.toLowerCase());
    if (hit) out.set(hit.token.toLowerCase(), hit);
  }
  for (const m of text.matchAll(CASHTAG)) {
    const sym = m[1].toLowerCase();
    if (GENERIC.has(sym)) continue;
    const hit = bySymbol.get(sym);
    if (hit) out.set(hit.token.toLowerCase(), hit);
  }
  return [...out.values()];
}

export function toPost(t: RawTweet, tokens: XPost["tokens"]): XPost {
  const user = t.author?.userName ?? "unknown";
  return {
    id: t.id,
    url: t.url ?? `https://x.com/${user}/status/${t.id}`,
    text: (t.text ?? "").slice(0, 400),
    at: unix(t.createdAt),
    likes: t.likeCount ?? 0,
    retweets: t.retweetCount ?? 0,
    views: t.viewCount ?? 0,
    author: { userName: user, name: t.author?.name ?? user, followers: t.author?.followers ?? 0, verified: !!t.author?.isBlueVerified, avatar: t.author?.profilePicture },
    tokens,
  };
}

export function buzzOf(posts: XPost[], now: number): TokenBuzz[] {
  const by = new Map<string, TokenBuzz & { authors: Set<string> }>();
  for (const p of posts) {
    if (now - p.at > 24 * 3600) continue;
    for (const t of p.tokens) {
      const key = t.token.toLowerCase();
      const b = by.get(key) ?? { ...t, mentions1h: 0, mentions24h: 0, reach24h: 0, top: null, authors: new Set<string>() };
      b.mentions24h++;
      if (now - p.at <= 3600) b.mentions1h++;
      if (!b.authors.has(p.author.userName)) {
        b.authors.add(p.author.userName);
        b.reach24h += p.author.followers;
      }
      if (!b.top || p.author.followers > b.top.followers) b.top = { userName: p.author.userName, followers: p.author.followers };
      by.set(key, b);
    }
  }
  return [...by.values()]
    .map(({ authors: _a, ...b }) => b)
    .sort((a, b) => b.mentions24h - a.mentions24h || b.reach24h - a.reach24h);
}

async function scan(provider: RobinhoodChainProvider, prev: State): Promise<State> {
  const cfg = getConfig();
  const { rows } = await exploreUniverse(provider);
  const byAddress: Known = new Map();
  const bySymbol: Known = new Map();
  // When tickers collide, the most traded launch owns the cashtag.
  const ranked = [...rows].sort((a, b) => b.vol30mUsd - a.vol30mUsd || (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0));
  for (const r of ranked) {
    const entry = { token: r.token, symbol: r.symbol };
    byAddress.set(r.token.toLowerCase(), entry);
    const sym = r.symbol.trim().toLowerCase();
    if (sym && !bySymbol.has(sym)) bySymbol.set(sym, entry);
  }
  const sat = { token: cfg.SAT_TOKEN_ADDRESS, symbol: "SAT" };
  byAddress.set(sat.token.toLowerCase(), sat);
  bySymbol.set("sat", sat);

  const since = Math.max(prev.scannedAt, Math.floor(Date.now() / 1000) - 6 * 3600) - 30;
  const watch = [sat.token, ...ranked.filter((r) => r.vol30mUsd > 0).slice(0, WATCH_TOKENS).map((r) => r.token)];
  const queries = [`(${watch.map((a) => `"${a}"`).join(" OR ")}) since_time:${since}`, `${ECOSYSTEM} since_time:${since} -filter:retweets`];

  const seen = new Set(prev.posts.map((p) => p.id));
  const fresh: XPost[] = [];
  let ran = false;
  for (const q of queries) {
    const tweets = await searchLatest(q);
    if (tweets === null) continue;
    ran = true;
    for (const t of tweets) {
      if (!t.id || seen.has(t.id)) continue;
      seen.add(t.id);
      const tokens = tokensIn(t.text ?? "", byAddress, bySymbol);
      if (!tokens.length && (t.author?.followers ?? 0) < cfg.SOCIAL_ALERT_FOLLOWERS) continue;
      fresh.push(toPost(t, tokens));
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const posts = [...fresh, ...prev.posts]
    .filter((p) => now - p.at <= KEEP_S)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_POSTS);
  return { posts, scannedAt: ran ? now : prev.scannedAt };
}

let running: Promise<State> | null = null;

/** The radar, rescanned when older than SOCIAL_SCAN_SECONDS. Pass refresh=false to only read. */
export async function getSocial(provider: RobinhoodChainProvider, refresh = true): Promise<SocialSnapshot> {
  const cfg = getConfig();
  const kv = getKv();
  let state = (await kv.get<State>(STATE_KEY).catch(() => null)) ?? { posts: [], scannedAt: 0 };
  const now = Math.floor(Date.now() / 1000);
  if (refresh && cfg.TWITTERAPI_IO_KEY && now - state.scannedAt >= cfg.SOCIAL_SCAN_SECONDS) {
    // Claim the scan first so parallel instances do not all hit the API.
    if (!running) {
      const claimed = { ...state, scannedAt: now };
      await kv.set(STATE_KEY, claimed, KEEP_S * 1000).catch(() => undefined);
      running = scan(provider, state)
        .then(async (next) => {
          await kv.set(STATE_KEY, next, KEEP_S * 1000);
          return next;
        })
        .catch(() => claimed)
        .finally(() => {
          running = null;
        });
    }
    // Serve the last scan while the next one runs; only the very first scan is awaited.
    if (state.scannedAt === 0) state = await running;
  }
  return {
    enabled: Boolean(cfg.TWITTERAPI_IO_KEY),
    posts: state.posts,
    tokens: buzzOf(state.posts, now),
    scannedAt: state.scannedAt,
    budget: { used: await callsToday(), cap: cfg.SOCIAL_MAX_CALLS_PER_DAY },
  };
}
