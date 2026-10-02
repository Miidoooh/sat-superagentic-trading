"use client";

import { fmtUsd } from "@/lib/format";
import type { Pick } from "@/lib/agent/strategy";
import { SocialLinks, TokenAvatar } from "../TokenAvatar";

const money = (n: number) => fmtUsd(n, { compact: true });

export interface BuyState {
  text: string;
  href?: string;
  tone?: "ok" | "bad";
  busy?: boolean;
}

interface Props {
  pick: Pick;
  rank: number;
  buy?: BuyState;
  onBuy: (p: Pick) => void;
  onOpen: (token: string) => void;
}

/** One agent pick: why it fits, and the exact plan to buy and get out. */
export default function PickCard({ pick: p, rank, buy, onBuy, onOpen }: Props) {
  const tone = p.score >= 80 ? "hot" : p.score >= 60 ? "warm" : "";
  return (
    <article className={`ag-pick ${rank === 0 ? "top" : ""}`}>
      <header className="ag-pick-head" role="button" tabIndex={0} onClick={() => onOpen(p.token)} onKeyDown={(e) => e.key === "Enter" && onOpen(p.token)}>
        <TokenAvatar src={p.logoUrl} symbol={p.symbol} seed={p.token} size={42} />
        <div className="ag-pick-id">
          <div className="ag-pick-sym">
            {p.symbol}
            <SocialLinks socials={p.socials} size={11} />
            <span className={`ag-stage ${p.stage}`}>{p.stage === "curve" ? `${p.progressPct.toFixed(0)}% bonded` : "Uniswap v4"}</span>
          </div>
          <div className="dim ag-pick-sub">
            {money(p.mcapUsd)} mcap{p.ageMin !== null ? ` · ${p.ageMin < 120 ? `${p.ageMin}m` : `${Math.round(p.ageMin / 60)}h`} old` : ""}
            {p.net30mUsd > 0 ? ` · +${money(p.net30mUsd)} net 30m` : ""}
          </div>
        </div>
        <span className={`ag-score ${tone}`} title="How strongly it fits your style right now" style={{ ["--s" as string]: p.score }}>
          {p.score}
        </span>
      </header>

      {p.warnings.length > 0 && (
        <div className="ag-warn">
          {p.warnings.map((w) => (
            <span key={w}>⚠ {w}</span>
          ))}
        </div>
      )}

      <ul className="ag-reasons">
        {p.reasons.slice(1).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <div className="ag-plan" aria-label="Plan">
        <div className="ag-lvl entry">
          <span className="k">Buy</span>
          <b className="mono">{money(p.plan.entryMcap)}</b>
          <span className="dim">{money(p.plan.buyUsd)}</span>
        </div>
        {p.plan.targets.map((t) => (
          <div key={t.atX} className="ag-lvl tp">
            <span className="k">Sell {t.sellPct}%</span>
            <b className="mono">{money(t.mcap)}</b>
            <span className="dim">{t.atX}×</span>
          </div>
        ))}
        <div className="ag-lvl sl">
          <span className="k">Stop</span>
          <b className="mono">{money(p.plan.stop.mcap)}</b>
          <span className="dim">−{p.plan.stop.pct}%</span>
        </div>
      </div>
      {(p.plan.trailingPct || p.plan.maxHoldHours) && (
        <div className="dim ag-plan-note">
          {p.plan.trailingPct ? `Trailing stop ${p.plan.trailingPct}% from the top. ` : ""}
          {p.plan.maxHoldHours ? `Out within ${p.plan.maxHoldHours}h.` : ""}
        </div>
      )}

      <footer className="ag-pick-foot">
        <button className="btn primary ag-buy" disabled={buy?.busy} onClick={() => onBuy(p)}>
          ⚡ Buy {money(p.plan.buyUsd)} & track plan
        </button>
        <button className="btn ghost" onClick={() => onOpen(p.token)}>
          Chart
        </button>
        {buy && (
          <span className={`ag-buy-status ${buy.tone ?? ""}`}>
            {buy.href ? (
              <a href={buy.href} target="_blank" rel="noreferrer noopener">
                {buy.text}
              </a>
            ) : (
              buy.text
            )}
          </span>
        )}
      </footer>
    </article>
  );
}
