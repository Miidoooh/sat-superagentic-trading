"use client";

import { useMemo, useState } from "react";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";

interface Props {
  tokens: TokenMarket[];
  selected: string;
  onSelect: (symbol: string) => void;
}

export default function TokenList({ tokens, selected, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) => t.token.symbol.toLowerCase().includes(q) || t.token.name.toLowerCase().includes(q),
    );
  }, [tokens, query]);

  return (
    <>
      <div className="search">
        <input
          value={query}
          placeholder="Search ticker or company…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="scroll">
        {tokens.length === 0 && <div className="msg dim">Loading markets…</div>}
        {tokens.length > 0 && filtered.length === 0 && <div className="msg dim">No match for “{query}”.</div>}
        {filtered.map((t) => (
          <button
            key={t.token.address}
            className={`token-row ${t.token.symbol === selected ? "active" : ""}`}
            onClick={() => onSelect(t.token.symbol)}
          >
            {t.token.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="logo" src={t.token.logoUrl} alt="" loading="lazy" />
            ) : (
              <span className="logo" />
            )}
            <span className="sym">{t.token.symbol}</span>
            <span className="px mono">${fmtPrice(t.priceUsd)}</span>
            <span className="sub">{fmtUsd(t.liquidityUsd, { compact: true })} liq</span>
            <span className={`chg mono ${(t.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}`}>
              {fmtPct(t.priceChange24hPct)}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
