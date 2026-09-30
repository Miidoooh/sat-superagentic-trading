"use client";

import { useEffect, useState } from "react";
import { fmtAgo, fmtUsd } from "@/lib/format";
import type { Leaderboard, TraderRow, WalletActivity } from "@/lib/radar/wallets";
import { shortAddr, useFollows } from "./follows";
import { usePoll } from "./usePoll";

interface Props {
  explorer: string;
  /** Wallet to open, e.g. from a Whale Radar click. */
  wallet: string;
  onWallet: (address: string) => void;
  onOpenToken: (token: string, venue: "stock" | "pons") => void;
}

function FollowButton({ address }: { address: `0x${string}` }) {
  const { isFollowed, toggle } = useFollows();
  const on = isFollowed(address);
  return (
    <button className={`btn sm ${on ? "primary" : ""}`} onClick={() => toggle(address)}>
      {on ? "★ Following" : "☆ Follow"}
    </button>
  );
}

function Board({ rows, mode, selected, onWallet }: { rows: TraderRow[]; mode: "volume" | "net"; selected: string; onWallet: Props["onWallet"] }) {
  const { isFollowed } = useFollows();
  return (
    <div className="board-rows">
      {rows.map((r, i) => (
        <button
          key={r.wallet}
          className={`board-row ${r.wallet.toLowerCase() === selected.toLowerCase() ? "active" : ""}`}
          onClick={() => onWallet(r.wallet)}
        >
          <span className="dim mono">{i + 1}</span>
          <span className="mono board-wallet">
            {isFollowed(r.wallet) && <span className="star">★</span>}
            {shortAddr(r.wallet)}
          </span>
          <span className="mono board-main">{fmtUsd(mode === "volume" ? r.volumeUsd : r.netUsd, { compact: true })}</span>
          <span className={`mono board-net ${r.netUsd >= 0 ? "up" : "down"}`}>
            {mode === "volume" ? `${r.netUsd >= 0 ? "+" : "−"}${fmtUsd(Math.abs(r.netUsd), { compact: true })}` : `${r.trades} tx`}
          </span>
          <span className="dim board-meta">
            {r.trades} trades · {r.tokens} tokens · most {r.topSymbol}
          </span>
        </button>
      ))}
    </div>
  );
}

function Detail({ address, explorer, onOpenToken }: { address: `0x${string}`; explorer: string; onOpenToken: Props["onOpenToken"] }) {
  const { data, error, loading } = usePoll<WalletActivity>(`/api/wallets?address=${address}`, 30_000);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="wallet-detail">
      <div className="wallet-head">
        <div>
          <div className="mono wallet-addr">{address}</div>
          <a className="dim" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer noopener">
            view on explorer ↗
          </a>
        </div>
        <div className="spacer" />
        <FollowButton address={address} />
      </div>

      {loading && !data && <div className="dim live-empty is-loading">Reading this wallet&apos;s last 24 hours of trades…</div>}
      {error && !data && <div className="banner error">{error}</div>}
      {data && (
        <>
          <div className="trench-stats">
            <div className="quote">
              <span className="k">Bought · 24h</span>
              <span className="v mono up">{fmtUsd(data.totals.buyUsd, { compact: true })}</span>
            </div>
            <div className="quote">
              <span className="k">Sold · 24h</span>
              <span className="v mono down">{fmtUsd(data.totals.sellUsd, { compact: true })}</span>
            </div>
            <div className="quote">
              <span className="k">Net</span>
              <span className={`v mono ${data.totals.netUsd >= 0 ? "up" : "down"}`}>
                {data.totals.netUsd >= 0 ? "+" : "−"}
                {fmtUsd(Math.abs(data.totals.netUsd), { compact: true })}
              </span>
            </div>
            <div className="quote">
              <span className="k">Trades</span>
              <span className="v mono">{data.totals.trades}</span>
            </div>
            <div className="quote">
              <span className="k">Last trade</span>
              <span className="v mono">{data.totals.lastSeen ? `${fmtAgo(data.totals.lastSeen, now)} ago` : "—"}</span>
            </div>
          </div>
          {data.totals.trades === 0 && <div className="dim live-empty">No trades from this wallet in the last 24 hours.</div>}
          <div className="wallet-cols">
            <div>
              <div className="live-sub">Tokens traded</div>
              {data.positions.map((p) => (
                <button key={p.token} className="flow-row" onClick={() => onOpenToken(p.token, p.venue)}>
                  <span className="flow-sym">
                    {p.symbol}
                    <span className={`venue-tag ${p.venue}`}>{p.venue}</span>
                  </span>
                  <span className={`mono ${p.netUsd >= 0 ? "up" : "down"}`}>
                    {p.netUsd >= 0 ? "+" : "−"}
                    {fmtUsd(Math.abs(p.netUsd), { compact: true })}
                  </span>
                  <span className="dim mono flow-meta">
                    bought {fmtUsd(p.buyUsd, { compact: true })} · sold {fmtUsd(p.sellUsd, { compact: true })} · {p.trades} tx
                  </span>
                </button>
              ))}
            </div>
            <div>
              <div className="live-sub">Trades</div>
              <div className="trade-rows">
                {data.trades.map((t) => (
                  <div key={t.id} className={`trade-row compact ${t.side}`}>
                    <span className={`side-badge ${t.side}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
                    <button className="trade-sym" onClick={() => onOpenToken(t.token, t.venue)}>
                      {t.symbol}
                      <span className={`venue-tag ${t.venue}`}>{t.venue}</span>
                    </button>
                    <span className={`mono trade-usd ${t.side === "buy" ? "up" : "down"}`}>{fmtUsd(t.usd, { compact: t.usd >= 100_000 })}</span>
                    <a className="dim mono trade-age" href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer noopener">
                      {fmtAgo(t.time, now)} ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function WalletTracker({ explorer, wallet, onWallet, onOpenToken }: Props) {
  const { data, error } = usePoll<Leaderboard>("/api/wallets", 30_000);
  const { follows, toggle } = useFollows();
  const [mode, setMode] = useState<"volume" | "net">("volume");
  const [query, setQuery] = useState("");
  const valid = /^0x[0-9a-fA-F]{40}$/.test(wallet);
  const rows = mode === "volume" ? data?.byVolume : data?.byNetBuy;

  return (
    <div className="live">
      <div className="live-head">
        <div>
          <div className="live-title">
            <span className="dot live" /> Smart Money
          </div>
          <div className="dim live-caption">
            The most active and most accumulating wallets across Stock Tokens and Pons curves. Follow a wallet to get alerts when it trades.
          </div>
        </div>
        <div className="spacer" />
        <form
          className="wallet-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^0x[0-9a-fA-F]{40}$/.test(query.trim())) onWallet(query.trim());
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Look up any wallet 0x…" spellCheck={false} />
          <button className="btn sm" type="submit" disabled={!/^0x[0-9a-fA-F]{40}$/.test(query.trim())}>
            Track
          </button>
        </form>
      </div>

      {follows.length > 0 && (
        <div className="follow-strip">
          <span className="dim">Following</span>
          {follows.map((f) => (
            <span key={f.address} className={`chip ${f.address.toLowerCase() === wallet.toLowerCase() ? "active" : ""}`}>
              <button className="mono" onClick={() => onWallet(f.address)}>
                {shortAddr(f.address)}
              </button>
              <button className="dim" title="Unfollow" onClick={() => toggle(f.address)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="live-body wallet-grid">
        <div className="board">
          <div className="live-sub">
            Leaderboard <span className="dim">{data ? (data.window === "24h" ? "last 24h" : "last 30m · 24h loading") : ""}</span>
            <div className="spacer" />
            <div className="tfs">
              <button className={`tf ${mode === "volume" ? "active" : ""}`} onClick={() => setMode("volume")}>
                Volume
              </button>
              <button className={`tf ${mode === "net" ? "active" : ""}`} onClick={() => setMode("net")}>
                Net buyers
              </button>
            </div>
          </div>
          {error && !data && <div className="banner error">{error}</div>}
          {!data && !error && <div className="dim live-empty">Ranking wallets…</div>}
          {rows && <Board rows={rows} mode={mode} selected={wallet} onWallet={onWallet} />}
        </div>
        {valid ? (
          <Detail key={wallet} address={wallet as `0x${string}`} explorer={explorer} onOpenToken={onOpenToken} />
        ) : (
          <div className="chart-empty">Pick a wallet from the leaderboard, or paste any address to see what it traded.</div>
        )}
      </div>
    </div>
  );
}
