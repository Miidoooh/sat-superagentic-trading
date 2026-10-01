"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/format";
import type { FlowReport } from "@/lib/report/flow";

/** Live proof under the hero: what SAT read from chain in the last 24 hours. */
export default function HeroPulse() {
  const [r, setR] = useState<FlowReport | null>(null);
  useEffect(() => {
    fetch("/api/report")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => d && !("error" in d) && setR(d))
      .catch(() => undefined);
  }, []);
  const v = (x: string | undefined) => x ?? <span className="dim">···</span>;
  return (
    <>
      <div className="pulse">
        <div className="pulse-item">
          <span className="v mono">{v(r ? fmtUsd(r.totals.volumeUsd, { compact: true }) : undefined)}</span>
          <span className="k">Volume read · 24h</span>
        </div>
        <div className="pulse-item">
          <span className="v mono">{v(r?.totals.trades.toLocaleString("en-US"))}</span>
          <span className="k">Trades tracked</span>
        </div>
        <div className="pulse-item">
          <span className="v mono">{v(r?.totals.wallets.toLocaleString("en-US"))}</span>
          <span className="k">Wallets watched</span>
        </div>
        <div className="pulse-item">
          <span className="v mono">{v(r ? String(r.pons.launches) : undefined)}</span>
          <span className="k">Pons launches</span>
        </div>
      </div>
      <Link className="pulse-link" href="/report">
        Read today&apos;s Robinhood Chain flow report →
      </Link>
    </>
  );
}
