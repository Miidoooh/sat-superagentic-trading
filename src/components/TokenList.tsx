"use client";

import { useEffect, useMemo, useState } from "react";
import { Flash } from "./Flash";
import { TokenAvatar } from "./TokenAvatar";
import PonsTopSlide from "@/components/PonsTopSlide";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";

type VenueFilter = "all" | "uniswap-v3" | "pons";

interface Props {
  tokens: TokenMarket[];
  selected: string;
  onSelect: (address: string) => void;
  /** Open a token that is not in the list (search results from the whole chain). */
  onOpenAddress: (address: string) => void;
  /** Open the full Pons explorer. */
  onExplore: () => void;
  /** The official SAT token, marked so copycats are easy to tell apart. */
  officialToken?: string;
}

interface ChainResult {
  address: `0x${string}`;
  symbol: string;
  name: string;
  kind: "stock" | "pons" | "graduated";
  logoUrl?: string;
}

const KIND_LABEL: Record<ChainResult["kind"], string> = { stock: "stock", pons: "pons", graduated: "graduated" };

/** Whole-chain search, debounced. */
function useChainSearch(query: string) {
  const [state, setState] = useState<{ q: string; results: ChainResult[]; loading: boolean; indexed: number }>({ q: "", results: [], loading: false, indexed: 0 });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setState({ q, results: [], loading: false, indexed: 0 });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: ChainResult[]; indexed?: number }) => setState({ q, results: d.results ?? [], loading: false, indexed: d.indexed ?? 0 }))
        .catch(() => undefined);
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);
  return state;
}

export default function TokenList({ tokens, selected, onSelect, onOpenAddress, onExplore, officialToken }: Props) {
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState<VenueFilter>("uniswap-v3");
  const chain = useChainSearch(query);
  const isOfficial = (a: string) => !!officialToken && a.toLowerCase() === officialToken.toLowerCase();

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
      // While searching, look across every venue so nothing hides behind a tab.
      if (!q && venue !== "all" && t.venue !== venue) return false;
      if (!q) return true;
      return t.token.symbol.toLowerCase().includes(q) || t.token.name.toLowerCase().includes(q) || t.token.address.toLowerCase() === q;
    });
  }, [tokens, query, venue]);

  const listedSet = useMemo(() => new Set(tokens.map((t) => t.token.address.toLowerCase())), [tokens]);
  const onChain = chain.results.filter((r) => !listedSet.has(r.address.toLowerCase()));
  const searching = query.trim().length >= 2;

  return (
    <>
      <div className="search">
        <input
          value={query}
          placeholder="Search tokens or paste 0x…"
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
      {(venue === "pons" || venue === "all") && (
        <PonsTopSlide tokens={tokens} selected={selected} onSelect={onSelect} />
      )}
      <div className="scroll">
        {venue === "pons" && !searching && (
          <button className="explore-link" onClick={onExplore}>
            Showing the top {counts.pons} curves. <b>Explore every live Pons launch →</b>
          </button>
        )}
        {tokens.length === 0 &&
          Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="token-row skeleton-row" aria-hidden="true">
              <span className="skeleton skel-logo" />
              <span className="skeleton skel-line" />
              <span className="skeleton skel-line short" />
            </div>
          ))}
        {tokens.length > 0 && filtered.length === 0 && !searching && <div className="msg dim">No match for “{query}”.</div>}
        {filtered.map((t) => (
          <button
            key={t.token.address}
            className={`token-row ${t.token.address === selected ? "active" : ""}`}
            onClick={() => onSelect(t.token.address)}
          >
            <TokenAvatar src={t.token.logoUrl} symbol={t.token.symbol} seed={t.token.address} size={30} />
            <span className="tr-main">
              <span className="sym">
                {t.token.symbol}
                {isOfficial(t.token.address) && <span className="official" title="The official SAT token">✓</span>}
                {t.venue === "pons" && <span className="tr-venue">pons</span>}
              </span>
              <span className="sub">
                {t.curve ? (
                  <>
                    <span className="tr-bond">
                      <span style={{ width: `${Math.min(100, Math.max(3, t.curve.progressPct))}%` }} />
                    </span>
                    {t.curve.progressPct.toFixed(0)}% · {fmtUsd(t.curve.raisedUsd, { compact: true })}
                  </>
                ) : (t.volume24hUsd ?? 0) > 0 ? (
                  `${fmtUsd(t.volume24hUsd, { compact: true })} vol`
                ) : (
                  `${fmtUsd(t.liquidityUsd, { compact: true })} liq`
                )}
              </span>
            </span>
            <span className="tr-side">
              <Flash value={t.priceUsd} className="px mono">
                ${fmtPrice(t.priceUsd)}
              </Flash>
              <span className={`chg mono ${t.priceChange24hPct === null ? "dim" : t.priceChange24hPct >= 0 ? "up" : "down"}`}>
                {fmtPct(t.priceChange24hPct)}
              </span>
            </span>
          </button>
        ))}
        {searching && (
          <>
            <div className="chain-results-head">
              <span>On Robinhood Chain</span>
              <span className="dim mono">{chain.loading ? "searching…" : chain.indexed ? `${chain.indexed.toLocaleString("en-US")} indexed` : ""}</span>
            </div>
            {!chain.loading && onChain.length === 0 && filtered.length === 0 && (
              <div className="msg dim">Nothing found. Paste the token&apos;s 0x address to look it up directly.</div>
            )}
            {onChain.map((r) => (
              <button key={r.address} className="token-row chain-result" onClick={() => onOpenAddress(r.address)} title={r.address}>
                <TokenAvatar src={r.logoUrl} symbol={r.symbol} seed={r.address} size={30} />
                <span className="tr-main">
                  <span className="sym">
                    {r.symbol}
                    {isOfficial(r.address) && <span className="official" title="The official SAT token">✓</span>}
                  </span>
                  <span className="sub">{r.name}</span>
                </span>
                <span className="tr-side">
                  <span className={`venue-tag ${r.kind === "stock" ? "stock" : "pons"}`}>{KIND_LABEL[r.kind]}</span>
                  <span className="dim mono chg">
                    {r.address.slice(0, 6)}…{r.address.slice(-4)}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
