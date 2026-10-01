import { satHolding } from "./token";
import { TIERS, type TierInfo } from "./tiers";

const lastKnown = new Map<string, TierInfo>();

/**
 * The tier a wallet's SAT holding earns. A failed chain read keeps the last
 * tier this process saw, so an RPC hiccup never downgrades a holder.
 */
export async function tierOf(wallet: `0x${string}` | undefined | null): Promise<TierInfo> {
  if (!wallet) return TIERS.free;
  try {
    const tier = TIERS[(await satHolding(wallet)).tier];
    lastKnown.set(wallet.toLowerCase(), tier);
    return tier;
  } catch {
    return lastKnown.get(wallet.toLowerCase()) ?? TIERS.free;
  }
}
