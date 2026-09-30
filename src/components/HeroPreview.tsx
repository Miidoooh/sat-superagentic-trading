"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtAgo, fmtUsd } from "@/lib/format";
import type { RadarSnapshot } from "@/lib/radar/whales";
import { usePoll } from "./usePoll";

const ROWS = 6;

/** A small live window onto Whale Radar for the landing page. */
export default function HeroPreview() {
  const { data } = usePoll<RadarSnapshot>(`/api/whales?minUsd=500&limit=${ROWS}`, 12_000);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, []);

  const totals = data?.totals;
  const buy = totals ? totals.stock.buyUsd + totals.pons.buyUsd : 0;
  const sell = totals ? totals.stock.sellUsd + totals.pons.sellUsd : 0;
  const share = buy + sell > 0 ? buy / (buy + sell) : 0.5;

  return (
    <Link href="/app?view=radar" className="preview" aria-label="Open Whale Radar">
      <div className="preview-bar">
        <span className="preview-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="preview-title">
          <span className="dot live" /> Whale Radar
        </span>
        <span className="dim">live · last 30 min</span>
      </div>

      <div className="preview-pressure">
        <div className="preview-pressure-labels">
          <span className="up mono">{totals ? fmtUsd(buy, { compact: true }) : "—"} bought</span>
          <span className="down mono">{totals ? fmtUsd(sell, { compact: true }) : "—"} sold</span>
        </div>
        <div className="pressure-bar">
          <span className="up-fill" style={{ width: `${share * 100}%` }} />
        </div>
      </div>

      <div className="preview-rows">
        {data
          ? data.trades.slice(0, ROWS).map((t) => (
              <div key={t.id} className="preview-row fade-in">
                <span className={`side-badge ${t.side}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
                <span className="preview-sym">
                  {t.symbol}
                  <span className={`venue-tag ${t.venue}`}>{t.venue === "pons" ? "pons" : "stock"}</span>
                </span>
                <span className={`mono ${t.side === "buy" ? "up" : "down"}`}>{fmtUsd(t.usd, { compact: true })}</span>
                <span className="dim mono">{fmtAgo(t.time, now)}</span>
              </div>
            ))
          : Array.from({ length: ROWS }, (_, i) => <div key={i} className="skeleton preview-skel" />)}
      </div>

      <div className="preview-foot">Open the radar →</div>
    </Link>
  );
}
