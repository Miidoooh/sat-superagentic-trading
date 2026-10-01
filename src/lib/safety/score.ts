/**
 * A quick, explainable risk read for a Pons launch from its on-chain history.
 * Every point taken off comes with the plain-words reason, so the score is
 * never a black box. It is a screen, not a guarantee.
 */

export interface SafetyInput {
  /** Seconds since launch. */
  ageSeconds: number;
  /** Holders with their share of supply, in percent. Curve and burn are excluded by label. */
  holders: { address: string; pct: number; label: "curve" | "deployer" | "burn" | null }[];
  deployer: string;
  /** Every curve trade since launch. */
  trades: { side: "buy" | "sell"; usd: number; trader: string | null }[];
  traders: number;
  raisedUsd: number;
}

export type SafetyGrade = "lower" | "caution" | "high";

export interface SafetyFlag {
  tone: "good" | "warn" | "bad";
  text: string;
}

export interface SafetyScore {
  score: number;
  grade: SafetyGrade;
  label: string;
  flags: SafetyFlag[];
  deployerPct: number;
  top10Pct: number;
  deployerSoldUsd: number;
  raisedPerHourUsd: number;
}

const pct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;
const usd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`);

export function safetyScore(input: SafetyInput): SafetyScore {
  const flags: SafetyFlag[] = [];
  let score = 100;
  const take = (points: number, tone: SafetyFlag["tone"], text: string) => {
    score -= points;
    flags.push({ tone, text });
  };

  const same = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
  const deployerPct = input.holders.find((h) => h.label === "deployer" || same(h.address, input.deployer))?.pct ?? 0;
  const wallets = input.holders.filter((h) => h.label !== "curve" && h.label !== "burn");
  const top10Pct = wallets
    .slice()
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10)
    .reduce((s, h) => s + h.pct, 0);
  const deployerBought = input.trades.filter((t) => t.side === "buy" && same(t.trader, input.deployer)).reduce((s, t) => s + t.usd, 0);
  const deployerSoldUsd = input.trades.filter((t) => t.side === "sell" && same(t.trader, input.deployer)).reduce((s, t) => s + t.usd, 0);
  const buyUsd = input.trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.usd, 0);
  const sellUsd = input.trades.filter((t) => t.side === "sell").reduce((s, t) => s + t.usd, 0);
  const hours = Math.max(input.ageSeconds / 3600, 1 / 60);
  const raisedPerHourUsd = input.raisedUsd / hours;

  if (deployerPct > 10) take(25, "bad", `Deployer still holds ${pct(deployerPct)} of supply`);
  else if (deployerPct > 5) take(12, "warn", `Deployer holds ${pct(deployerPct)} of supply`);
  else flags.push({ tone: "good", text: deployerPct > 0 ? `Deployer holds only ${pct(deployerPct)}` : "Deployer holds none of the supply" });

  if (top10Pct > 50) take(25, "bad", `Top 10 wallets hold ${pct(top10Pct)}`);
  else if (top10Pct > 35) take(12, "warn", `Top 10 wallets hold ${pct(top10Pct)}`);
  else flags.push({ tone: "good", text: `Spread out: top 10 wallets hold ${pct(top10Pct)}` });

  if (deployerSoldUsd > 0 && deployerSoldUsd >= deployerBought * 0.5) take(20, "bad", `Deployer has sold ${usd(deployerSoldUsd)}`);
  else if (deployerSoldUsd > 0) take(8, "warn", `Deployer sold ${usd(deployerSoldUsd)} of what they bought`);

  if (input.traders < 10) take(15, "warn", `Only ${input.traders} wallets have traded`);
  else if (input.traders < 25) take(7, "warn", `${input.traders} wallets have traded`);
  else flags.push({ tone: "good", text: `${input.traders} different wallets have traded` });

  const flow = buyUsd + sellUsd;
  if (flow > 0 && buyUsd / flow < 0.4) take(10, "warn", `Sellers lead: ${pct((sellUsd / flow) * 100)} of volume is selling`);

  if (input.ageSeconds < 10 * 60) take(5, "warn", "Under 10 minutes old, too early to judge");
  if (raisedPerHourUsd > 20_000 && input.traders < 15) take(10, "warn", `Fast fill from few wallets (${usd(raisedPerHourUsd)}/h)`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade: SafetyGrade = score >= 75 ? "lower" : score >= 50 ? "caution" : "high";
  const label = grade === "lower" ? "Lower risk" : grade === "caution" ? "Caution" : "High risk";
  return { score, grade, label, flags, deployerPct, top10Pct, deployerSoldUsd, raisedPerHourUsd };
}
