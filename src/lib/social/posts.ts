import type { AlertItem } from "../alerts/detect";

/** X posts about Robinhood Chain tokens, as the radar stores and serves them. Safe to import in the browser. */

export interface XPost {
  id: string;
  url: string;
  text: string;
  at: number;
  likes: number;
  retweets: number;
  views: number;
  author: { userName: string; name: string; followers: number; verified: boolean; avatar?: string };
  tokens: { token: `0x${string}`; symbol: string }[];
}

export interface TokenBuzz {
  token: `0x${string}`;
  symbol: string;
  mentions1h: number;
  mentions24h: number;
  /** Sum of followers of every account that posted, last 24h. */
  reach24h: number;
  top: { userName: string; followers: number } | null;
}

export interface SocialSnapshot {
  enabled: boolean;
  posts: XPost[];
  tokens: TokenBuzz[];
  scannedAt: number;
  budget: { used: number; cap: number };
}

export const compactCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/** Alerts for posts about a token from accounts with at least `minFollowers`. */
export function socialAlerts(posts: XPost[], minFollowers: number): AlertItem[] {
  return posts
    .filter((p) => p.tokens.length > 0 && p.author.followers >= minFollowers)
    .map((p) => ({
      id: `x:${p.id}`,
      kind: "social" as const,
      title: `📣 @${p.author.userName} (${compactCount(p.author.followers)} followers) on ${p.tokens.map((t) => `$${t.symbol}`).join(" ")}`,
      body: p.text.replace(/\s+/g, " ").slice(0, 160),
      token: p.tokens[0].token,
      url: p.url,
    }));
}

/** One line for a pick: how loud a token is on X. */
export function buzzLine(b: TokenBuzz): string {
  const top = b.top && b.top.followers >= 1000 ? `, top @${b.top.userName} (${compactCount(b.top.followers)})` : "";
  return `${b.mentions24h} post${b.mentions24h === 1 ? "" : "s"} on X in 24h${top}`;
}
