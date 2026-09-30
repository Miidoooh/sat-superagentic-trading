"use client";

import { useEffect, useRef, useState } from "react";
import { fmtAgo, fmtNum, fmtUsd } from "@/lib/format";
import type { FlowRow, RadarSnapshot, RadarVenue, WhaleTrade } from "@/lib/radar/whales";
import { usePoll } from "./usePoll";

const SIZES = [250, 1_000, 5_000, 25_000];
const VENUES: { id: "all" | RadarVenue; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stocks" },
  { id: "pons", label: "Pons" },
];

interface Props {
  explorer: string;
  onOpenToken: (token: string, venue: RadarVenue) => void;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function FlowList({ title, rows, tone, onOpen }: { title: string; rows: FlowRow[]; tone: "up" | "down"; onOpen: Props["onOpenToken"] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.netUsd)));
  return (
    <div className="flow-card">
      <div className="live-sub">{title}</div>
      {rows.length === 0 && <div className="dim live-empty">Nothing yet</div>}
      {rows.map((r) => (
        <button key={r.token} className="flow-row" onClick={() => onOpen(r.token, r.venue)}>
          <span className={`flow-bar ${tone}`} style={{ width: `${(Math.abs(r.netUsd) / max) * 100}%` }} />
          <span className="flow-sym">
            {r.symbol}
            <span className={`venue-tag ${r.venue}`}>{r.venue === "pons" ? "pons" : "stock"}</span>
          </span>
          <span className={`mono ${tone}`}>
            {r.netUsd >= 0 ? "+" : "−"}
            {fmtUsd(Math.abs(r.netUsd), { compact: true })}
          </span>
          <span className="dim mono flow-meta">
            {r.trades} tx · {r.traders} wallets
          </span>
        </button>
      ))}
    </div>
  );
}

export default function WhaleRadar({ explorer, onOpenToken }: Props) {
  const [minUsd, setMinUsd] = useState(1_000);
  const [venue, setVenue] = useState<"all" | RadarVenue>("all");
  const { data, error, loading } = usePoll<RadarSnapshot>(`/api/whales?minUsd=${minUsd}&venue=${venue}`, 12_000);

  // Rows that were not in the previous payload flash once.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const ids = data.trades.map((t) => t.id);
    if (seen.current) setFresh(new Set(ids.filter((id) => !seen.current!.has(id))));
    seen.current = new Set(ids);
  }, [data]);
  useEffect(() => {
    seen.current = null;
  }, [minUsd, venue]);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, []);

  const totals = data?.totals;
  const combined = totals
    ? venue === "all"
      ? {
          buyUsd: totals.stock.buyUsd + totals.pons.buyUsd,
          sellUsd: totals.stock.sellUsd + totals.pons.sellUsd,
          trades: totals.stock.trades + totals.pons.trades,
        }
      : totals[venue]
    : null;
  const buyShare = combined && combined.buyUsd + combined.sellUsd > 0 ? combined.buyUsd / (combined.buyUsd + combined.sellUsd) : 0.5;

  return (
    <div className="live">
      <div className="live-head">
        <div>
          <div className="live-title">
            <span className="dot live" /> Whale Radar
          </div>
          <div className="dim live-caption">
            Every Stock Token swap and Pons curve trade on Robinhood Chain, last {data?.windowMinutes ?? 30} minutes, straight from chain logs.
          </div>
        </div>
        <div className="spacer" />
        <div className="tfs">
          {VENUES.map((v) => (
            <button key={v.id} className={`tf ${venue === v.id ? "active" : ""}`} onClick={() => setVenue(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="tfs">
          {SIZES.map((s) => (
            <button key={s} className={`tf ${minUsd === s ? "active" : ""}`} onClick={() => setMinUsd(s)}>
              ≥{fmtUsd(s, { compact: true })}
            </button>
          ))}
        </div>
      </div>

      {error && !data && <div className="banner error">Could not load the radar: {error}</div>}

      {combined && (
        <div className="pressure">
          <div className="pressure-labels">
            <span className="up mono">Buys {fmtUsd(combined.buyUsd, { compact: true })}</span>
            <span className="dim">{fmtNum(combined.trades, 0)} trades · 30m</span>
            <span className="down mono">Sells {fmtUsd(combined.sellUsd, { compact: true })}</span>
          </div>
          <div className="pressure-bar">
            <span className="up-fill" style={{ width: `${buyShare * 100}%` }} />
          </div>
        </div>
      )}

      <div className="live-body radar-grid">
        <div className="radar-feed">
          <div className="live-sub">
            Big trades <span className="dim">≥ {fmtUsd(minUsd, { compact: true })}</span>
          </div>
          {loading && !data && <div className="dim live-empty">Reading the last 30 minutes of trades…</div>}
          {data && data.trades.length === 0 && <div className="dim live-empty">No trades this size in the window.</div>}
          <div className="trade-rows">
            {data?.trades.map((t: WhaleTrade) => (
              <div key={t.id} className={`trade-row ${t.side} ${fresh.has(t.id) ? "flash" : ""}`}>
                <span className={`side-badge ${t.side}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
                <button className="trade-sym" onClick={() => onOpenToken(t.token, t.venue)}>
                  {t.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="logo" src={t.logoUrl} alt="" />
                  )}
                  {t.symbol}
                  <span className={`venue-tag ${t.venue}`}>{t.venue === "pons" ? "pons" : t.quoteSymbol}</span>
                </button>
                <span className={`mono trade-usd ${t.side === "buy" ? "up" : "down"}`}>{fmtUsd(t.usd, { compact: t.usd >= 100_000 })}</span>
                <span className="dim mono trade-wallet">
                  {t.trader ? (
                    <a href={`${explorer}/address/${t.trader}`} target="_blank" rel="noreferrer noopener">
                      {short(t.trader)}
                    </a>
                  ) : (
                    "router"
                  )}
                </span>
                <a className="dim mono trade-age" href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer noopener">
                  {fmtAgo(t.time, now)} ↗
                </a>
              </div>
            ))}
          </div>
        </div>
        <div className="radar-flows">
          <FlowList title="Net inflow" rows={data?.inflows ?? []} tone="up" onOpen={onOpenToken} />
          <FlowList title="Net outflow" rows={data?.outflows ?? []} tone="down" onOpen={onOpenToken} />
        </div>
      </div>
    </div>
  );
}
