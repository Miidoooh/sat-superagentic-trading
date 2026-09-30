"use client";

import { useEffect, useState } from "react";
import { fmtPrice, fmtUsd } from "@/lib/format";

interface PonsTick {
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  quoteSymbol: string;
}

export default function PonsTicker() {
  const [ticks, setTicks] = useState<PonsTick[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/summary")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d: { pons?: PonsTick[] }) => {
        if (alive && d.pons?.length) setTicks(d.pons);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!ticks?.length) return null;

  const loop = [...ticks, ...ticks];
  return (
    <div className="ticker pons-ticker">
      <div className="pons-ticker-label">Pons</div>
      <div className="ticker-track pons-ticker-track">
        {loop.map((t, i) => (
          <span className="tick pons-tick" key={`${t.symbol}-${i}`}>
            <b>{t.symbol}</b>
            <span className="mono">${fmtPrice(t.priceUsd)}</span>
            <span className="mono muted">
              {fmtUsd(t.liquidityUsd, { compact: true })} · {t.quoteSymbol}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
