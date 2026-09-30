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
        .sort(
          (a, b) =>
            (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0) || b.liquidityUsd - a.liquidityUsd,
        )
        .slice(0, TOP_N),
    [tokens],
  );

  if (top.length === 0) return null;

  return (
    <div className="pons-slide">
      <div className="pons-slide-head">
        <span className="pons-slide-title">Top curves</span>
        <span className="dim">by depth</span>
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
          </button>
        ))}
      </div>
    </div>
  );
}
