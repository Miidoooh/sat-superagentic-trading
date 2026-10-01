/**
 * SAT holder tiers. A wallet's tier is the USD value of the SAT it holds,
 * read live from chain. Shared by the browser and the server.
 */

export type TierId = "free" | "holder" | "whale";

export interface TierInfo {
  id: TierId;
  name: string;
  maxRules: number;
  /** How long Telegram alerts wait before sending. Holders get them first. */
  telegramDelayMs: number;
  perks: string[];
}

export const TIERS: Record<TierId, TierInfo> = {
  free: {
    id: "free",
    name: "Free",
    maxRules: 3,
    telegramDelayMs: 60_000,
    perks: ["Full terminal, radar and trenches", "3 autopilot rules", "Telegram alerts, 60s behind holders", "Launch safety scores"],
  },
  holder: {
    id: "holder",
    name: "Holder",
    maxRules: 15,
    telegramDelayMs: 0,
    perks: ["Everything in Free", "15 autopilot rules", "Instant Telegram alerts, 24/7", "Holder badge on PnL cards"],
  },
  whale: {
    id: "whale",
    name: "Whale",
    maxRules: 30,
    telegramDelayMs: 0,
    perks: ["Everything in Holder", "30 autopilot rules", "Whale badge on PnL cards", "First look at new features"],
  },
};

export interface TierThresholds {
  holderUsd: number;
  whaleUsd: number;
}

export function tierFor(usd: number, t: TierThresholds): TierId {
  if (usd >= t.whaleUsd) return "whale";
  if (usd >= t.holderUsd) return "holder";
  return "free";
}

/** USD still needed to reach the next tier, or null at the top. */
export function nextTier(usd: number, t: TierThresholds): { id: TierId; needUsd: number } | null {
  if (usd < t.holderUsd) return { id: "holder", needUsd: t.holderUsd - usd };
  if (usd < t.whaleUsd) return { id: "whale", needUsd: t.whaleUsd - usd };
  return null;
}

/** The message a wallet signs to prove it owns the address it claims a tier for. */
export function verifyMessage(address: string, issuedAt: number): string {
  return `SAT holder check\n\nWallet: ${address.toLowerCase()}\nIssued: ${new Date(issuedAt).toISOString()}\n\nSigning is free and does not move funds.`;
}
