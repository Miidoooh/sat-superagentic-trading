"use client";

import { useEffect, useState } from "react";
import { fmtAgo, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { TIERS, type TierId } from "@/lib/sat/tiers";
import { shortAddr } from "./follows";
import { referralLink, useReferralCount } from "./referral";
import { TierBadge, useSat } from "./sat";
import { useWallet } from "./wallet";

const ORDER: TierId[] = ["free", "holder", "whale"];

const compactSat = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : n.toFixed(0);

/** Everything about the SAT token: live market, your tier, and what holding unlocks. */
export default function SatView({ explorer, feeWallet }: { explorer: string; feeWallet: string | null }) {
  const wallet = useWallet();
  const { market, holding, tier, thresholds, feeBps, loading } = useSat();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  const refs = useReferralCount(wallet.address);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(t);
  }, []);

  const min = (id: TierId) => (id === "whale" ? thresholds.whaleUsd : id === "holder" ? thresholds.holderUsd : 0);
  const next = holding?.next ?? null;
  const progress = next ? Math.min(100, ((holding?.valueUsd ?? 0) / min(next.id)) * 100) : 100;
  const change = market?.change24hPct ?? null;

  return (
    <div className="live sat-view">
      <section className="sat-hero">
        <div className="sat-hero-main">
          <div className="sat-kicker">The SAT token</div>
          <h1 className="sat-title">
            Hold SAT. <span className="grad">Get the edge first.</span>
          </h1>
          <p className="muted sat-lead">
            Holders get instant alerts, more autopilot rules and 24/7 Telegram delivery. Your tier is read straight from your wallet: no signup,
            no staking, no lockup.
          </p>
          <div className="sat-cta-row">
            <a className="btn primary lg" href={market?.buyUrl} target="_blank" rel="noreferrer noopener">
              Buy SAT ↗
            </a>
            {!wallet.address && (
              <button className="btn lg ghost" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
                {wallet.connecting ? "Connecting…" : "Check my tier"}
              </button>
            )}
            {market && (
              <a className="dim mono sat-contract" href={market.explorerUrl} target="_blank" rel="noreferrer noopener" title="Token contract">
                {shortAddr(market.address)} ↗
              </a>
            )}
          </div>
        </div>
        <div className="sat-stats">
          <div className="sat-stat big">
            <span className="k">Price</span>
            <span className="v mono">{market ? `$${fmtPrice(market.priceUsd)}` : <span className="skeleton pf-skel" />}</span>
            {change !== null && <span className={`mono ${change >= 0 ? "up" : "down"}`}>{fmtPct(change)} 24h</span>}
          </div>
          <div className="sat-stat">
            <span className="k">Market cap</span>
            <span className="v mono">{market ? fmtUsd(market.marketCapUsd, { compact: true }) : "—"}</span>
          </div>
          <div className="sat-stat">
            <span className="k">24h volume</span>
            <span className="v mono">{market ? fmtUsd(market.volume24hUsd, { compact: true }) : "—"}</span>
          </div>
          <div className="sat-stat">
            <span className="k">24h trades</span>
            <span className="v mono">
              {market ? market.trades24h.toLocaleString("en-US") : "—"}
              {market && market.trades24h > 0 && <span className="dim"> · {Math.round((market.buys24h / market.trades24h) * 100)}% buys</span>}
            </span>
          </div>
        </div>
      </section>

      <div className="live-body sat-body">
        <section className={`sat-me ${wallet.address ? "has-ref" : ""}`}>
          <div className="live-sub">Your tier</div>
          {!wallet.address ? (
            <div className="sat-me-card is-empty">
              <TierBadge tier={TIERS.free} size="lg" />
              <span className="muted">Connect a wallet to see your SAT balance, your tier and how far you are from the next one.</span>
              <button className="btn primary" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
                {wallet.connecting ? "Connecting…" : "Connect wallet"}
              </button>
            </div>
          ) : (
            <div className="sat-me-card">
              <TierBadge tier={tier} size="lg" />
              <div className="sat-me-numbers">
                <span className="mono">{holding ? `${holding.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })} SAT` : loading ? "…" : "0 SAT"}</span>
                <span className="dim mono">{holding ? fmtUsd(holding.valueUsd) : ""}</span>
              </div>
              <div className="sat-progress">
                <div className="sat-progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <span className="dim">
                {next ? `${fmtUsd(next.needUsd)} more SAT to reach ${TIERS[next.id].name}` : "Top tier. Thank you for holding."}
              </span>
            </div>
          )}
          {wallet.address && (
            <div className="sat-ref">
              <div className="sat-ref-head">
                <strong>Invite traders</strong>
                <span className="dim mono">{refs === null ? "" : `${refs} joined`}</span>
              </div>
              <div className="sat-ref-row">
                <input readOnly className="mono" value={referralLink(wallet.address)} onFocus={(e) => e.currentTarget.select()} />
                <button
                  className="btn sm"
                  onClick={() =>
                    void navigator.clipboard.writeText(referralLink(wallet.address!)).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <span className="dim">Every PnL card you share carries this link too.</span>
            </div>
          )}
        </section>

        <section className="sat-tiers">
          {ORDER.map((id) => {
            const t = TIERS[id];
            return (
              <div key={id} className={`sat-tier ${id} ${tier.id === id ? "is-current" : ""}`}>
                <div className="sat-tier-head">
                  <TierBadge tier={t} />
                  <span className="mono dim">{id === "free" ? "$0" : `$${min(id).toLocaleString("en-US")}+ in SAT`}</span>
                </div>
                <ul>
                  {t.perks.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                {tier.id === id && <span className="sat-tier-you">You are here</span>}
              </div>
            );
          })}
        </section>

        <section className="sat-split">
          <div>
            <div className="live-sub">
              Live SAT trades <span className="dim">Uniswap v4</span>
            </div>
            <div className="sat-trades">
              {(market?.recent ?? []).map((t) => (
                <div key={`${t.tx}:${t.time}:${t.usd}`} className="sat-trade">
                  <span className={`side-badge ${t.side}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
                  <span className={`mono ${t.side === "buy" ? "up" : "down"}`}>{fmtUsd(t.usd)}</span>
                  <span className="dim mono sat-amt">{compactSat(t.sat)} SAT</span>
                  <a className="dim mono trade-age" href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer noopener">
                    {fmtAgo(t.time, now)} ↗
                  </a>
                </div>
              ))}
              {market && market.recent.length === 0 && <div className="dim live-empty">No SAT trades in the last 24 hours.</div>}
              {!market && <div className="dim live-empty is-loading">Reading the SAT pool…</div>}
            </div>
          </div>
          <div className="sat-fee">
            <div className="live-sub">Where the fee goes</div>
            <p className="muted">
              Stock Token trades placed through SAT carry a {feeBps / 100}% fee, taken by the Uniswap router in the same transaction. It goes to the
              SAT treasury wallet, which funds SAT buybacks.
            </p>
            {feeWallet && (
              <a className="mono dim" href={`${explorer}/address/${feeWallet}`} target="_blank" rel="noreferrer noopener">
                Treasury {shortAddr(feeWallet)} ↗
              </a>
            )}
            <p className="dim sat-disclaimer">Holding SAT unlocks product features. It is not an investment promise.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
