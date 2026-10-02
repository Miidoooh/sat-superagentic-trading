"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { FlowReport, ReportFlow, ReportTrade } from "@/lib/report/flow";
import { shortAddr } from "./follows";

const REFRESH_MS = 5 * 60_000;

function FlowList({ title, rows, tone, className = "" }: { title: string; rows: ReportFlow[]; tone: "up" | "down"; className?: string }) {
  return (
    <div className={`rp-card ${className}`}>
      <div className="rp-label">{title}</div>
      {rows.length === 0 && <div className="dim">Nothing notable.</div>}
      {rows.map((f) => (
        <Link key={f.token} className="rp-row" href={`/app?token=${f.token}`}>
          <span className="rp-sym">{f.symbol}</span>
          <span className="dim mono">{f.traders} wallets</span>
          <span className={`mono ${tone}`}>
            {f.netUsd > 0 ? "+" : ""}
            {fmtUsd(f.netUsd, { compact: true })}
          </span>
        </Link>
      ))}
    </div>
  );
}

function BuyList({ title, rows, className = "" }: { title: string; rows: ReportTrade[]; className?: string }) {
  return (
    <div className={`rp-card ${className}`}>
      <div className="rp-label">{title}</div>
      {rows.length === 0 && <div className="dim">Nothing notable.</div>}
      {rows.map((t) => (
        <Link key={t.tx} className="rp-row" href={`/app?token=${t.token}`}>
          <span className="rp-sym">{t.symbol}</span>
          <span className="dim mono">{t.trader ? shortAddr(t.trader) : ""}</span>
          <span className="mono up">{fmtUsd(t.usd, { compact: true })}</span>
        </Link>
      ))}
    </div>
  );
}

/** The daily flow report as a page anyone can open and share. */
export default function ReportView() {
  const [r, setR] = useState<FlowReport | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/report")
        .then(async (res) => {
          const d = await res.json();
          if (!res.ok || "error" in d) throw new Error(d.error ?? "Report unavailable");
          setR(d as FlowReport);
          setError("");
        })
        .catch((e: Error) => setError(e.message));
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const [url, setUrl] = useState("https://sathood.xyz/report");
  useEffect(() => setUrl(`${window.location.origin}/report`), []);
  const lead = r?.inflows[0];
  const whale = r?.biggestBuys[0];
  const post = r
    ? `Robinhood Chain tokens, last 24h by @sat_hood:\n\n${fmtUsd(r.totals.ponsUsd, { compact: true })} traded · ${r.pons.launches} launches · ${r.pons.graduations} graduated${lead ? `\nHottest: $${lead.symbol} (+${fmtUsd(lead.netUsd, { compact: true })} net in)` : ""}${whale ? `\nBiggest buy: ${fmtUsd(whale.usd, { compact: true })} of $${whale.symbol}` : ""}\n\n`
    : "";
  const day = r ? new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "";

  return (
    <div className="rp">
      <header className="rp-head">
        <div>
          <div className="sat-kicker">Daily token report</div>
          <h1>
            What the degens bought, <span className="grad">last 24 hours</span>
          </h1>
          <p className="muted">
            {r ? `${day} · updated ${new Date(r.generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Reading every Pons and Uniswap trade from chain…"}
          </p>
        </div>
        <div className="rp-share">
          <a className="btn primary" href={`https://x.com/intent/post?text=${encodeURIComponent(post)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer noopener" aria-disabled={!r}>
            Post on X
          </a>
          <button
            className="btn"
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <a className="btn ghost" href="/api/card/report" download="sat-flow-report.png">
            Image
          </a>
        </div>
      </header>

      {error && !r && <div className="banner error">{error}</div>}
      {!r && !error && <div className="dim live-empty is-loading">Building today&apos;s report from chain. The first one of the day takes about a minute.</div>}

      {r && (
        <>
          <section className="rp-totals">
            <div className="sat-stat big">
              <span className="k">Token volume</span>
              <span className="v mono">{fmtUsd(r.totals.ponsUsd, { compact: true })}</span>
              <span className="dim mono">+ {fmtUsd(r.totals.stockUsd, { compact: true })} in stock tokens</span>
            </div>
            <div className="sat-stat">
              <span className="k">Trades</span>
              <span className="v mono">{r.totals.trades.toLocaleString("en-US")}</span>
            </div>
            <div className="sat-stat">
              <span className="k">Wallets</span>
              <span className="v mono">{r.totals.wallets.toLocaleString("en-US")}</span>
            </div>
            <div className="sat-stat">
              <span className="k">Buy share</span>
              <span className={`v mono ${r.totals.buySharePct >= 50 ? "up" : "down"}`}>{r.totals.buySharePct.toFixed(0)}%</span>
            </div>
            <div className="sat-stat">
              <span className="k">New launches</span>
              <span className="v mono">{r.pons.launches}</span>
              <span className="dim mono">{r.pons.graduations} graduated</span>
            </div>
          </section>
          {r.ponsWindowHours < 24 && <div className="dim rp-note">Token figures cover the last 30 minutes while the full 24h history finishes loading.</div>}

          <section className="rp-grid">
            <FlowList title="🔥 Hottest tokens: net money in" rows={r.inflows} tone="up" />
            <BuyList title="🐋 Biggest token buys" rows={r.biggestBuys} />
            <FlowList title="🩸 Getting dumped" rows={r.outflows} tone="down" />
            <div className="rp-card">
              <div className="rp-label">🧠 Smart money: biggest token buyers</div>
              {r.smartMoney.map((w) => (
                <Link key={w.wallet} className="rp-row" href={`/app?view=wallets&wallet=${w.wallet}`}>
                  <span className="mono">{shortAddr(w.wallet)}</span>
                  <span className="dim">mostly {w.topSymbol}</span>
                  <span className="mono up">+{fmtUsd(w.netUsd, { compact: true })}</span>
                </Link>
              ))}
            </div>
            <div className="rp-card rp-wide">
              <div className="rp-label">🎓 About to graduate</div>
              {r.watch.length === 0 && <div className="dim">No curve is close to graduating right now.</div>}
              {r.watch.map((w) => (
                <Link key={w.token} className="rp-row" href={`/app?token=${w.token}`}>
                  <span className="rp-sym">{w.symbol}</span>
                  <span className="dim mono">
                    {w.progressPct.toFixed(0)}% to graduation · {fmtUsd(w.raisedUsd, { compact: true })} raised
                  </span>
                  {w.safety ? (
                    <span className={`rp-safety ${w.safety.score >= 75 ? "good" : w.safety.score >= 50 ? "warn" : "bad"}`}>
                      {w.safety.score} · {w.safety.label}
                    </span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </Link>
              ))}
              {r.pons.graduated.length > 0 && <div className="dim rp-note">Graduated today: {r.pons.graduated.join(", ")}</div>}
            </div>
          </section>

          {r.stocks && (
            <section className="rp-stocks">
              <div className="rp-label">Stock tokens</div>
              <div className="rp-grid">
                <FlowList title="Net money in" rows={r.stocks.inflows.slice(0, 3)} tone="up" className="rp-mini" />
                <FlowList title="Net money out" rows={r.stocks.outflows} tone="down" className="rp-mini" />
                <BuyList title="Biggest buys" rows={r.stocks.biggestBuys.slice(0, 3)} className="rp-mini" />
              </div>
            </section>
          )}

          <section className="rp-cta">
            <div>
              <strong>Get this live, not once a day.</strong>
              <span className="muted"> SAT watches every trade on Robinhood Chain and alerts you the moment whales move.</span>
            </div>
            <div className="rp-cta-row">
              {r.sat && (
                <span className="dim mono">
                  SAT ${fmtPrice(r.sat.priceUsd)}
                  {r.sat.change24hPct !== null && <span className={r.sat.change24hPct >= 0 ? "up" : "down"}> {fmtPct(r.sat.change24hPct)}</span>}
                </span>
              )}
              <Link className="btn primary" href="/app">
                Open SAT
              </Link>
              <Link className="btn ghost" href="/app?view=sat">
                Hold SAT
              </Link>
            </div>
          </section>
          <p className="dim rp-fine">Read from Robinhood Chain event logs. Not investment advice.</p>
        </>
      )}
    </div>
  );
}
