/**
 * Average-cost profit and loss over the fills SAT can see. Holdings bought
 * before the window have no known cost, so unrealized PnL only covers the part
 * of the balance that window buys explain, and `coveredPct` says how much.
 */

export interface Fill {
  side: "buy" | "sell";
  /** Token amount, whole units */
  amount: number;
  usd: number;
}

export interface PnlResult {
  bought: number;
  sold: number;
  costUsd: number;
  proceedsUsd: number;
  avgCostUsd: number | null;
  realizedUsd: number;
  unrealizedUsd: number | null;
  /** Share of the current balance whose cost is known, 0..100 */
  coveredPct: number;
}

export function computePnl(fills: Fill[], balance: number, priceUsd: number): PnlResult {
  let bought = 0;
  let sold = 0;
  let costUsd = 0;
  let proceedsUsd = 0;
  for (const f of fills) {
    if (!(f.amount > 0) || !Number.isFinite(f.usd)) continue;
    if (f.side === "buy") {
      bought += f.amount;
      costUsd += f.usd;
    } else {
      sold += f.amount;
      proceedsUsd += f.usd;
    }
  }
  const avgCostUsd = bought > 0 ? costUsd / bought : null;
  // Sales beyond what was bought in the window sold older coins of unknown cost.
  const matchedSold = Math.min(sold, bought);
  const realizedUsd = avgCostUsd !== null && sold > 0 ? proceedsUsd * (matchedSold / sold) - avgCostUsd * matchedSold : 0;
  const openFromWindow = Math.max(0, bought - sold);
  const covered = Math.min(balance, openFromWindow);
  const unrealizedUsd = avgCostUsd !== null && covered > 0 ? covered * (priceUsd - avgCostUsd) : avgCostUsd !== null ? 0 : null;
  const coveredPct = balance > 0 ? Math.min(100, (covered / balance) * 100) : bought > 0 ? 100 : 0;
  return { bought, sold, costUsd, proceedsUsd, avgCostUsd, realizedUsd, unrealizedUsd, coveredPct };
}
