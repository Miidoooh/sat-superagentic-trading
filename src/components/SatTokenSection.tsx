"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { SatMarket } from "@/lib/sat/token";
import { TIERS, type TierId, type TierThresholds } from "@/lib/sat/tiers";

const ORDER: TierId[] = ["free", "holder", "whale"];

/** Landing section for the SAT token: live price and what each tier unlocks. */
export default function SatTokenSection() {
  const [data, setData] = useState<{ market: SatMarket; thresholds: TierThresholds; feeBps: number } | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/sat")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const m = data?.market;
  const min = (id: TierId) => (id === "whale" ? data?.thresholds.whaleUsd : id === "holder" ? data?.thresholds.holderUsd : 0) ?? 0;

  return (
    <section className="sat-land">
      <div className="sat-land-head">
        <div>
          <div className="sat-kicker">The SAT token</div>
          <h2>
            Hold SAT. <span className="grad">Get the edge first.</span>
          </h2>
          <p className="muted">
            Your tier is read live from your wallet. No signup, no staking, no lockup. Holders get every alert before everyone else.
          </p>
        </div>
        <div className="sat-land-ticker">
          <div className="sat-stat big">
            <span className="k">SAT price</span>
            <span className="v mono">{m ? `$${fmtPrice(m.priceUsd)}` : "…"}</span>
            {m?.change24hPct != null && <span className={`mono ${m.change24hPct >= 0 ? "up" : "down"}`}>{fmtPct(m.change24hPct)} 24h</span>}
          </div>
          <div className="sat-stat">
            <span className="k">Market cap</span>
            <span className="v mono">{m ? fmtUsd(m.marketCapUsd, { compact: true }) : "…"}</span>
          </div>
          <div className="sat-stat">
            <span className="k">24h volume</span>
            <span className="v mono">{m ? fmtUsd(m.volume24hUsd, { compact: true }) : "…"}</span>
          </div>
        </div>
      </div>
      <div className="sat-tiers">
        {ORDER.map((id) => (
          <div key={id} className={`sat-tier ${id}`}>
            <div className="sat-tier-head">
              <span className={`tier-badge ${id}`}>
                {id === "whale" ? "🐋 " : id === "holder" ? "◆ " : ""}
                {TIERS[id].name}
              </span>
              <span className="mono dim">{id === "free" ? "$0" : `$${min(id).toLocaleString("en-US")}+ in SAT`}</span>
            </div>
            <ul>
              {TIERS[id].perks.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="cta sat-land-cta">
        <a className="btn primary lg" href={m?.buyUrl ?? "/app?view=sat"} target={m ? "_blank" : undefined} rel="noreferrer noopener">
          Buy SAT ↗
        </a>
        <Link className="btn lg ghost" href="/app?view=sat">
          Check my tier
        </Link>
      </div>
      <p className="fine">
        {data?.feeBps ? `A ${data.feeBps / 100}% fee on Stock Token trades placed through SAT funds SAT buybacks. ` : ""}Holding SAT unlocks product
        features; it is not an investment promise.
      </p>
    </section>
  );
}
