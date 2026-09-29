"use client";

import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/format";

interface Summary {
  tokenCount: number;
  withHistory: number;
  totalLiquidityUsd: number;
}

const CHAIN_ID = 4663;

export default function LandingStats() {
  const [s, setS] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/summary")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d: Summary) => alive && setS(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const value = (v: string | number | undefined) =>
    v !== undefined ? v : failed ? "—" : <span className="dim">···</span>;

  return (
    <div className="stats">
      <div className="stat">
        <div className="k">Chain</div>
        <div className="v">{CHAIN_ID}</div>
      </div>
      <div className="stat">
        <div className="k">Stock tokens</div>
        <div className="v mono">{value(s?.tokenCount)}</div>
      </div>
      <div className="stat">
        <div className="k">With price history</div>
        <div className="v mono">{value(s?.withHistory)}</div>
      </div>
      <div className="stat">
        <div className="k">Pool liquidity</div>
        <div className="v mono">{value(s ? fmtUsd(s.totalLiquidityUsd, { compact: true }) : undefined)}</div>
      </div>
    </div>
  );
}
