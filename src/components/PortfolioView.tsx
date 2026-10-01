"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtAgo, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { Portfolio } from "@/lib/portfolio/portfolio";
import { shortAddr } from "./follows";
import { TRADED_EVENT, tradedTokens, useWallet } from "./wallet";

const REFRESH_MS = 45_000;
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

interface Props {
  explorer: string;
  onOpenToken: (token: string) => void;
}

function Signed({ value, compact }: { value: number | null; compact?: boolean }) {
  if (value === null) return <span className="dim">—</span>;
  const tone = value > 0.005 ? "up" : value < -0.005 ? "down" : "";
  return (
    <span className={`mono ${tone}`}>
      {value > 0.005 ? "+" : value < -0.005 ? "−" : ""}
      {fmtUsd(Math.abs(value), { compact })}
    </span>
  );
}

export default function PortfolioView({ explorer, onOpenToken }: Props) {
  const wallet = useWallet();
  const [lookup, setLookup] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const address = viewing ?? wallet.address;
  const own = address !== null && address.toLowerCase() === wallet.address?.toLowerCase();

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const tokens = own ? tradedTokens().join(",") : "";
      const r = await fetch(`/api/portfolio?address=${address}${tokens ? `&tokens=${tokens}` : ""}`);
      const d = (await r.json()) as Portfolio | { error: string };
      if (!r.ok || "error" in d) throw new Error("error" in d ? d.error : "Could not load the portfolio");
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [address, own]);

  useEffect(() => {
    setData(null);
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    window.addEventListener(TRADED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(TRADED_EVENT, load);
    };
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(t);
  }, []);

  const lookupForm = (
    <form
      className="pf-lookup"
      onSubmit={(e) => {
        e.preventDefault();
        if (isAddress(lookup.trim())) setViewing(lookup.trim());
      }}
    >
      <input placeholder="Look up any wallet: 0x…" value={lookup} onChange={(e) => setLookup(e.target.value)} />
      <button className="btn sm" disabled={!isAddress(lookup.trim())}>
        View
      </button>
    </form>
  );

  if (!address) {
    return (
      <div className="live pf">
        <div className="pf-empty">
          <div className="pf-empty-title">Your portfolio, read from chain</div>
          <p className="muted">Connect a wallet to see what you hold, what it is worth, and your profit and loss on every Stock Token and Pons launch.</p>
          <button className="btn primary" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
            {wallet.connecting ? "Connecting…" : "Connect wallet"}
          </button>
          {wallet.error && <div className="down">{wallet.error}</div>}
          <div className="dim pf-or">or</div>
          {lookupForm}
        </div>
      </div>
    );
  }

  const totalPnl = data ? data.realizedUsd + data.unrealizedUsd : null;

  return (
    <div className="live pf">
      <div className="live-head">
        <div>
          <div className="live-title">
            {own ? "My portfolio" : "Portfolio"}
            <a className="dim mono pf-addr" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer noopener">
              {shortAddr(address)} ↗
            </a>
          </div>
          <div className="dim live-caption">
            Balances are live. Profit and loss covers trades in the last {data?.windowDays ?? 11} days, priced from each fill&apos;s own swap.
          </div>
        </div>
        <div className="spacer" />
        {viewing && wallet.address && (
          <button className="btn sm" onClick={() => setViewing(null)}>
            Back to my wallet
          </button>
        )}
        {lookupForm}
      </div>

      {error && !data && <div className="banner error">{error}</div>}

      <div className="live-body pf-body">
        <div className="pf-cards">
          <div className="pf-card">
            <div className="k">Total value</div>
            <div className="v mono">{data ? fmtUsd(data.totalUsd) : <span className="skeleton pf-skel" />}</div>
          </div>
          <div className="pf-card">
            <div className="k">Tokens</div>
            <div className="v mono">{data ? fmtUsd(data.tokensUsd) : <span className="skeleton pf-skel" />}</div>
          </div>
          <div className="pf-card">
            <div className="k">{data?.nativeSymbol ?? "ETH"}</div>
            <div className="v mono">{data ? `${data.native.balance.toFixed(4)}` : <span className="skeleton pf-skel" />}</div>
            {data && <div className="dim mono">{fmtUsd(data.native.valueUsd)}</div>}
          </div>
          <div className="pf-card">
            <div className="k">Unrealized PnL</div>
            <div className="v">{data ? <Signed value={data.unrealizedUsd} /> : <span className="skeleton pf-skel" />}</div>
          </div>
          <div className="pf-card">
            <div className="k">Realized PnL</div>
            <div className="v">{data ? <Signed value={data.realizedUsd} /> : <span className="skeleton pf-skel" />}</div>
            {totalPnl !== null && (
              <div className="dim">
                Net <Signed value={totalPnl} compact />
              </div>
            )}
          </div>
        </div>

        <div className="live-sub">
          Holdings {loading && data && <span className="dim">refreshing…</span>}
          {data && data.partial.length > 0 && <span className="dim">history still loading for {data.partial.join(", ")}</span>}
        </div>
        {!data && loading && <div className="dim live-empty is-loading">Reading balances and trade history from chain…</div>}
        {data && data.holdings.length === 0 && (
          <div className="dim live-empty">No Stock Tokens or Pons launches in this wallet yet. Buy one from the Terminal and it shows up here.</div>
        )}
        {data && data.holdings.length > 0 && (
          <div className="pf-table">
            <div className="pf-row pf-head">
              <span>Token</span>
              <span>Balance</span>
              <span>Price</span>
              <span>Value</span>
              <span>Avg cost</span>
              <span>PnL</span>
            </div>
            {data.holdings.map((h) => {
              const pnl = h.unrealizedUsd === null ? null : h.unrealizedUsd + h.realizedUsd;
              const basis = h.avgCostUsd !== null ? h.avgCostUsd * Math.min(h.balance, Math.max(0, h.bought - h.sold)) : 0;
              const pnlPct = h.unrealizedUsd !== null && basis > 0 ? (h.unrealizedUsd / basis) * 100 : null;
              return (
                <button key={h.token} className="pf-row" onClick={() => onOpenToken(h.token)} title="Open chart and trade">
                  <span className="pf-token">
                    {h.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="logo" src={h.logoUrl} alt="" />
                    )}
                    <b>{h.symbol}</b>
                    <span className={`venue-tag ${h.venue === "pons" ? "pons" : "stock"}`}>{h.venue === "pons" ? "pons" : "stock"}</span>
                  </span>
                  <span className="mono">{h.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                  <span className="mono">
                    ${fmtPrice(h.priceUsd)}
                    {h.change24hPct !== null && <span className={h.change24hPct >= 0 ? "up" : "down"}> {fmtPct(h.change24hPct)}</span>}
                  </span>
                  <span className="mono">{fmtUsd(h.valueUsd)}</span>
                  <span className="mono">{h.avgCostUsd === null ? <span className="dim">unknown</span> : `$${fmtPrice(h.avgCostUsd)}`}</span>
                  <span className="pf-pnl">
                    <Signed value={pnl} />
                    {pnlPct !== null && <span className={`mono ${pnlPct >= 0 ? "up" : "down"}`}>{fmtPct(pnlPct)}</span>}
                    {h.balance > 0 && h.coveredPct < 99 && <span className="dim">cost known for {h.coveredPct.toFixed(0)}%</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {data && data.trades.length > 0 && (
          <>
            <div className="live-sub">Recent fills</div>
            <div className="trade-rows">
              {data.trades.map((t) => (
                <div key={t.id} className={`trade-row compact ${t.side}`}>
                  <span className={`side-badge ${t.side}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
                  <button className="trade-sym" onClick={() => onOpenToken(t.token)}>
                    {t.symbol}
                    <span className={`venue-tag ${t.venue === "pons" ? "pons" : "stock"}`}>{t.venue === "pons" ? "pons" : "stock"}</span>
                  </button>
                  <span className={`mono trade-usd ${t.side === "buy" ? "up" : "down"}`}>{fmtUsd(t.usd, { compact: t.usd >= 100_000 })}</span>
                  <span className="dim mono">{t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                  <a className="dim mono trade-age" href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer noopener">
                    {fmtAgo(t.time, now)} ↗
                  </a>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
