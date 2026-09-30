"use client";

import { useMemo } from "react";
import { fmtPrice, fmtUsd } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";

const TOP_N = 14;

interface Props {
  tokens: TokenMarket[];
  selected: string;
  onSelect: (address: string) => void;
}

/** Deepest Pons bonding curves — horizontal snap strip above the Pons list. */
export default function PonsTopSlide({ tokens, selected, onSelect }: Props) {
  const top = useMemo(
    () =>
      tokens
        .filter((t) => t.venue === "pons")
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
        .slice(0, TOP_N),
    [tokens],
  );

  if (top.length === 0) return null;

  return (
    <div className="pons-slide">
      <div className="pons-slide-head">
        <span className="pons-slide-title">Top curves</span>
        <span className="dim">by amount raised</span>
      </div>
      <div className="pons-slide-track">
        {top.map((t, i) => (
          <button
            key={t.token.address}
            type="button"
            className={`pons-card ${t.token.address === selected ? "active" : ""}`}
            onClick={() => onSelect(t.token.address)}
          >
            <span className="pons-rank mono">{i + 1}</span>
            <span className="pons-sym">{t.token.symbol}</span>
            <span className="pons-px mono">${fmtPrice(t.priceUsd)}</span>
            <span className="pons-meta">
              {fmtUsd(t.liquidityUsd, { compact: true })} · {t.quoteSymbol}
            </span>
            {t.curve && (
              <span className={`curve-progress ${t.curve.progressPct >= 80 ? "hot" : t.curve.progressPct >= 40 ? "warm" : ""}`}>
                <span style={{ width: `${Math.min(100, Math.max(2, t.curve.progressPct))}%` }} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
