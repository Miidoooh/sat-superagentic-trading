"use client";

import { useMemo, useState } from "react";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";

type VenueFilter = "all" | "uniswap-v3" | "pons";

interface Props {
  tokens: TokenMarket[];
  selected: string;
  onSelect: (address: string) => void;
}

export default function TokenList({ tokens, selected, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState<VenueFilter>("all");

  const counts = useMemo(
    () => ({
      all: tokens.length,
      "uniswap-v3": tokens.filter((t) => t.venue !== "pons").length,
      pons: tokens.filter((t) => t.venue === "pons").length,
    }),
    [tokens],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tokens.filter((t) => {
      if (venue !== "all" && t.venue !== venue) return false;
      if (!q) return true;
      return t.token.symbol.toLowerCase().includes(q) || t.token.name.toLowerCase().includes(q);
    });
  }, [tokens, query, venue]);

  return (
    <>
      <div className="search">
        <input
          value={query}
          placeholder="Search ticker or name…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="venue-tabs">
          {(
            [
              ["all", "All"],
              ["uniswap-v3", "Stocks"],
              ["pons", "Pons"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`tf ${venue === id ? "active" : ""}`} onClick={() => setVenue(id)}>
              {label}
              <span className="mono">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="scroll">
        {tokens.length === 0 && <div className="msg dim">Loading markets…</div>}
        {tokens.length > 0 && filtered.length === 0 && <div className="msg dim">No match for “{query}”.</div>}
        {filtered.map((t) => (
          <button
            key={t.token.address}
            className={`token-row ${t.token.address === selected ? "active" : ""}`}
            onClick={() => onSelect(t.token.address)}
          >
            {t.token.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="logo" src={t.token.logoUrl} alt="" loading="lazy" />
            ) : (
              <span className="logo" />
            )}
            <span className="sym">{t.token.symbol}</span>
            <span className="px mono">${fmtPrice(t.priceUsd)}</span>
            <span className="sub">
              {t.venue === "pons" ? "Pons · " : ""}
              {fmtUsd(t.liquidityUsd, { compact: true })} {t.venue === "pons" ? "curve" : "liq"}
            </span>
            <span className={`chg mono ${(t.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}`}>
              {fmtPct(t.priceChange24hPct)}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
