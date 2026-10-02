"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtAgo, fmtPrice, fmtUsd } from "@/lib/format";
import type { ExplorePage, ExploreRow, ExploreSort, ExploreTab } from "@/lib/radar/explore";
import { setMood } from "./brand/mood";
import { Flash } from "./Flash";
import { SocialLinks, TokenAvatar } from "./TokenAvatar";
import { executeTrade } from "./tradeExec";
import { useWallet } from "./wallet";

const REFRESH_MS = 10_000;
/** Launches younger than this get a NEW badge. */
const NEW_SECONDS = 5 * 60;

const TABS: { id: ExploreTab; label: string; hint: string }[] = [
  { id: "new", label: "New pairs", hint: "Newest launches first" },
  { id: "trending", label: "Trending", hint: "Most traded in the last 30 minutes" },
  { id: "almost", label: "Almost bonded", hint: "Closest to graduating" },
  { id: "graduated", label: "Graduated", hint: "Moved to Uniswap v4 in the last day" },
];

const SORTS: { id: ExploreSort; label: string }[] = [
  { id: "age", label: "Age" },
  { id: "mcap", label: "Market cap" },
  { id: "volume", label: "Volume 30m" },
  { id: "txns", label: "Txns 30m" },
  { id: "net", label: "Net flow" },
  { id: "progress", label: "Bonding %" },
];

const MCAPS = [0, 5_000, 20_000, 100_000];
const VOLS = [0, 500, 5_000, 25_000];
const QUICK_USD = [5, 10, 25, 50, 100];
const QUICK_KEY = "sat:quickbuy";

interface QuickStatus {
  text: string;
  href?: string;
  tone?: "ok" | "bad";
  busy?: boolean;
}

interface Props {
  onOpenToken: (token: string, url?: string) => void;
}

function Bonding({ pct }: { pct: number }) {
  const tone = pct >= 100 ? "done" : pct >= 80 ? "hot" : pct >= 40 ? "warm" : "";
  return (
    <span className={`ex-bond ${tone}`} title={`${pct.toFixed(1)}% of the graduation target raised`}>
      <span className="ex-bond-bar">
        <span style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
      </span>
      <span className="mono">{pct >= 100 ? "100%" : `${pct.toFixed(pct < 10 ? 1 : 0)}%`}</span>
    </span>
  );
}

/** GMGN-style table over every scanned Pons launch. */
export default function ExploreView({ onOpenToken }: Props) {
  const [tab, setTab] = useState<ExploreTab>("new");
  const [sort, setSort] = useState<ExploreSort | null>(null);
  const [q, setQ] = useState("");
  const [minMcap, setMinMcap] = useState(0);
  const [minVol, setMinVol] = useState(0);
  const [socials, setSocials] = useState(false);
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState<ExplorePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const seq = useRef(0);

  const url = useCallback(() => {
    const p = new URLSearchParams({ tab, limit: String(limit) });
    if (sort) p.set("sort", sort);
    if (q.trim()) p.set("q", q.trim());
    if (minMcap) p.set("minMcap", String(minMcap));
    if (minVol) p.set("minVol", String(minVol));
    if (socials) p.set("socials", "1");
    return `/api/explore?${p}`;
  }, [tab, sort, q, minMcap, minVol, socials, limit]);

  useEffect(() => {
    let alive = true;
    const id = ++seq.current;
    setLoading(true);
    const load = async () => {
      try {
        const r = await fetch(url());
        const d = (await r.json()) as ExplorePage | { error: string };
        if (!alive || id !== seq.current) return;
        if (!r.ok || "error" in d) throw new Error("error" in d ? d.error : "Could not load launches");
        setPage(d);
        setError("");
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    const t0 = setTimeout(load, q ? 250 : 0);
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [url, q]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setLimit(50), [tab, sort, q, minMcap, minVol, socials]);

  const activeSort = sort ?? (tab === "trending" ? "volume" : tab === "almost" ? "progress" : "age");
  const rows = page?.tab === tab ? page.rows : [];
  const open = (r: ExploreRow) => onOpenToken(r.token, r.url);

  const wallet = useWallet();
  const [quickUsd, setQuickUsd] = useState(10);
  const [buys, setBuys] = useState<Record<string, QuickStatus>>({});
  useEffect(() => {
    const saved = Number(localStorage.getItem(QUICK_KEY));
    if (QUICK_USD.includes(saved)) setQuickUsd(saved);
  }, []);
  const pickQuick = (v: number) => {
    setQuickUsd(v);
    localStorage.setItem(QUICK_KEY, String(v));
  };
  const quickAmount = (r: ExploreRow) => (r.payUsd > 0 ? Number((quickUsd / r.payUsd).toPrecision(3)) : 0);

  async function quickBuy(r: ExploreRow) {
    const amount = quickAmount(r);
    if (!amount) return;
    const set = (s: QuickStatus | null) =>
      setBuys((b) => {
        const next = { ...b };
        if (s) next[r.token] = s;
        else delete next[r.token];
        return next;
      });
    set({ text: "Preparing…", busy: true });
    try {
      const built = await executeTrade({ side: "buy", token: r.token, amount }, wallet, (text, href) => set({ text, href, busy: true }));
      set({ text: `Bought ≥ ${built.minOut}`, tone: "ok" });
      setMood("pump");
    } catch (e) {
      const msg = (e as Error).message;
      set({ text: /user rejected|denied/i.test(msg) ? "Cancelled" : msg, tone: "bad" });
    }
    setTimeout(() => set(null), 9_000);
  }

  return (
    <div className="live ex">
      <div className="ex-head">
        <div className="ex-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className={`ex-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)} title={t.hint}>
              {t.label}
              {page && <span className="mono">{page.counts[t.id].toLocaleString("en-US")}</span>}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="ex-live">
          <span className="dot live" /> live · {page?.scanned ? `${page.scanned.toLocaleString("en-US")} curves scanned` : "reading launches from chain…"}
        </span>
      </div>

      <div className="ex-filters">
        <input className="ex-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ticker, name or 0x address…" />
        <div className="ex-group">
          <span className="dim">MCap ≥</span>
          {MCAPS.map((v) => (
            <button key={v} className={`chip ${minMcap === v ? "on" : ""}`} onClick={() => setMinMcap(v)}>
              {v ? fmtUsd(v, { compact: true }) : "any"}
            </button>
          ))}
        </div>
        {tab !== "graduated" && (
          <div className="ex-group">
            <span className="dim">Vol 30m ≥</span>
            {VOLS.map((v) => (
              <button key={v} className={`chip ${minVol === v ? "on" : ""}`} onClick={() => setMinVol(v)}>
                {v ? fmtUsd(v, { compact: true }) : "any"}
              </button>
            ))}
          </div>
        )}
        <button className={`chip ${socials ? "on" : ""}`} onClick={() => setSocials((s) => !s)} title="Only tokens that list an X, Telegram, Discord or website">
          Has socials
        </button>
        <div className="ex-group" title="One tap buys this much of a token. You still sign every trade in your wallet.">
          <span className="dim">⚡ Quick buy</span>
          {QUICK_USD.map((v) => (
            <button key={v} className={`chip ${quickUsd === v ? "on" : ""}`} onClick={() => pickQuick(v)}>
              ${v}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <label className="ex-sort">
          <span className="dim">Sort</span>
          <select value={activeSort} onChange={(e) => setSort(e.target.value as ExploreSort)}>
            {SORTS.filter((s) => tab !== "graduated" || s.id === "age" || s.id === "mcap").map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && !page && <div className="banner error">{error}</div>}

      <div className="ex-table">
        <div className="ex-row ex-th">
          <span>Token</span>
          <span>{tab === "graduated" ? "Graduated" : "Age"}</span>
          <span>{tab === "graduated" ? "MCap at grad" : "MCap"}</span>
          <span>{tab === "graduated" ? "Pool seeded" : "Bonding"}</span>
          <span>Vol 30m</span>
          <span>Txns · wallets</span>
          <span>Net 30m</span>
          <span>Price</span>
          <span />
        </div>
        {((loading && !page) || page?.scanned === 0) &&
          Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="ex-row skeleton-row" aria-hidden>
              <span className="skeleton skel-line" />
              <span className="skeleton skel-line short" />
              <span className="skeleton skel-line short" />
              <span className="skeleton skel-line" />
            </div>
          ))}
        {page && page.scanned > 0 && rows.length === 0 && <div className="dim live-empty">No launches match these filters.</div>}
        {rows.map((r, i) => (
          <div key={r.token} className="ex-row" role="button" tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => e.key === "Enter" && open(r)}>
            <span className="ex-token">
              {tab === "trending" && <span className="ex-rank mono">{i + 1}</span>}
              <TokenAvatar src={r.logoUrl} symbol={r.symbol} seed={r.token} size={34} />
              <span className="ex-names">
                <span className="ex-sym">
                  {r.symbol}
                  {r.launchedAt !== null && now - r.launchedAt < NEW_SECONDS && tab !== "graduated" && <span className="ex-badge new">NEW</span>}
                  {tab === "trending" && i < 3 && <span className="ex-badge hot">🔥 HOT</span>}
                  <SocialLinks socials={r.socials} size={11} />
                </span>
                <span className="dim ex-name">{r.name || `${r.token.slice(0, 6)}…${r.token.slice(-4)}`}</span>
              </span>
            </span>
            <span className="mono dim">{(tab === "graduated" ? r.graduatedAt : r.launchedAt) ? fmtAgo((tab === "graduated" ? r.graduatedAt : r.launchedAt)!, now) : "—"}</span>
            <Flash value={r.mcapUsd} className="mono">
              {r.mcapUsd !== null ? fmtUsd(r.mcapUsd, { compact: true }) : "—"}
            </Flash>
            {tab === "graduated" ? <span className="mono">{fmtUsd(r.raisedUsd * 2, { compact: true })}</span> : <Bonding pct={r.progressPct} />}
            <span className="mono">{r.vol30mUsd ? fmtUsd(r.vol30mUsd, { compact: true }) : <span className="dim">—</span>}</span>
            <span className="mono dim">{r.txns30m ? `${r.txns30m} · ${r.traders30m}` : "—"}</span>
            <span className={`mono ${r.net30mUsd > 0 ? "up" : r.net30mUsd < 0 ? "down" : "dim"}`}>
              {r.net30mUsd ? `${r.net30mUsd > 0 ? "+" : "−"}${fmtUsd(Math.abs(r.net30mUsd), { compact: true })}` : "—"}
            </span>
            <Flash value={r.priceUsd} className="mono">
              {r.priceUsd !== null ? `$${fmtPrice(r.priceUsd)}` : "—"}
            </Flash>
            <span className="ex-actions">
              <button
                className="btn sm ex-quick"
                disabled={!!buys[r.token]?.busy || !quickAmount(r)}
                onClick={(e) => {
                  e.stopPropagation();
                  void quickBuy(r);
                }}
                title={`Buy $${quickUsd} of ${r.symbol} (${quickAmount(r)} ${r.paySymbol}). You sign it in your wallet.`}
              >
                ⚡ ${quickUsd}
              </button>
              <a className="btn sm ghost ex-pons" href={r.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} title="Open on Pons">
                ↗
              </a>
              {buys[r.token] && (
                <span className={`ex-qstatus ${buys[r.token].tone ?? ""}`} onClick={(e) => e.stopPropagation()}>
                  {buys[r.token].href ? (
                    <a href={buys[r.token].href} target="_blank" rel="noreferrer noopener">
                      {buys[r.token].text}
                    </a>
                  ) : (
                    buys[r.token].text
                  )}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {page && page.total > rows.length && (
        <div className="ex-more">
          <button className="btn" onClick={() => setLimit((l) => Math.min(300, l + 50))} disabled={limit >= 300}>
            {limit >= 300
              ? `Showing 300 of ${page.total.toLocaleString("en-US")}. Narrow the filters or search to find the rest.`
              : `Load more · ${rows.length} of ${page.total.toLocaleString("en-US")}`}
          </button>
        </div>
      )}
    </div>
  );
}
