"use client";

import { useEffect, useState } from "react";
import { fmtPct, fmtPrice } from "@/lib/format";

interface Tick {
  symbol: string;
  priceUsd: number;
  changePct: number | null;
}

/**
 * Live strip of real Robinhood Chain prices. Rendered client-side so the
 * landing page paints instantly and never blocks on an RPC round trip.
 */
export default function Ticker() {
  const [ticks, setTicks] = useState<Tick[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/summary")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d: { tokens?: Tick[] }) => {
        if (alive && d.tokens?.length) setTicks(d.tokens);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!ticks) {
    return (
      <div className="ticker">
        <div className="ticker-track" style={{ animation: "none" }}>
          <span className="tick muted">Connecting to Robinhood Chain…</span>
        </div>
      </div>
    );
  }

  // Duplicated so the marquee wraps seamlessly at -50%.
  const loop = [...ticks, ...ticks];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {loop.map((t, i) => (
          <span className="tick" key={`${t.symbol}-${i}`}>
            <b>{t.symbol}</b>
            <span className="mono">${fmtPrice(t.priceUsd)}</span>
            <span className={`mono ${(t.changePct ?? 0) >= 0 ? "up" : "down"}`}>{fmtPct(t.changePct)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
