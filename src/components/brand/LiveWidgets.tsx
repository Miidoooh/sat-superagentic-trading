"use client";

import { useEffect, useState } from "react";
import { fmtAgo, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import type { PonsTokenDetail } from "@/lib/data/ponsToken";
import type { ExplorePage } from "@/lib/radar/explore";
import type { RadarSnapshot } from "@/lib/radar/whales";
import { compactCount, type SocialSnapshot } from "@/lib/social/posts";
import type { TokenMarket } from "@/lib/types";
import { Flash } from "../Flash";
import { TokenAvatar } from "../TokenAvatar";
import { usePoll } from "../usePoll";

type Open = (token: string) => void;

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Skeleton({ n = 5 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-row" aria-hidden>
          <span className="skeleton skel-dot" />
          <span className="skeleton skel-line" />
          <span className="skeleton skel-line short" />
        </div>
      ))}
    </>
  );
}

const whaleSize = (usd: number) => (usd >= 25_000 ? 26 : usd >= 10_000 ? 22 : usd >= 5_000 ? 18 : 15);

/** The latest big trades, whales sized by how big they are. Token whales first; stocks only fill the gaps. */
export function LiveWhales({ limit = 6, onOpen }: { limit?: number; onOpen?: Open }) {
  const { data } = usePoll<RadarSnapshot>("/api/whales?minUsd=250&venue=all&limit=80", 10_000);
  const now = useNow();
  const trades = data?.trades ?? [];
  const pons = trades.filter((t) => t.venue === "pons");
  const rows = [
    ...pons.filter((t) => t.usd >= 500),
    ...trades.filter((t) => t.venue !== "pons" && t.usd >= 2_500),
    ...pons.filter((t) => t.usd < 500),
  ].slice(0, limit);
  return (
    <div className="sx-card">
      <div className="sx-card-head">
        <span>Whale trades · last 30 min</span>
        <span className="sx-live-tag">
          <span className="dot live" /> live
        </span>
      </div>
      {!data && <Skeleton n={limit} />}
      {rows.map((t) => (
        <div key={t.id} className="sx-row" role={onOpen ? "button" : undefined} onClick={() => onOpen?.(t.token)} style={{ cursor: onOpen ? "pointer" : undefined }}>
          <span className="sx-row-id">
            <span className="sx-whale-ico" style={{ fontSize: whaleSize(t.usd) }} aria-hidden>
              🐋
            </span>
            <TokenAvatar src={t.logoUrl} symbol={t.symbol} seed={t.token} size={26} />
            <span>
              <b>{t.symbol}</b>
              <div className="dim">{t.side === "buy" ? "bought" : "sold"} · {fmtAgo(t.time, now)} ago</div>
            </span>
          </span>
          <span className={`mono ${t.side === "buy" ? "up" : "down"}`} style={{ fontWeight: 700 }}>
            {t.side === "buy" ? "+" : "−"}
            {fmtUsd(t.usd, { compact: true })}
          </span>
          <span className="dim mono" style={{ fontSize: 12 }}>
            {t.venue === "pons" ? "pons" : "stock"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What is running right now on Pons. */
export function LiveTrending({ limit = 5, onOpen }: { limit?: number; onOpen?: Open }) {
  const { data } = usePoll<ExplorePage>(`/api/explore?tab=trending&limit=${limit}`, 12_000);
  return (
    <div className="sx-card">
      <div className="sx-card-head">
        <span>Trending launches · 30 min</span>
        <span className="sx-live-tag">
          <span className="dot live" /> live
        </span>
      </div>
      {(!data || data.scanned === 0) && <Skeleton n={limit} />}
      {data?.rows.map((r, i) => (
        <div key={r.token} className="sx-row" role={onOpen ? "button" : undefined} onClick={() => onOpen?.(r.token)} style={{ cursor: onOpen ? "pointer" : undefined, animationDelay: `${i * 60}ms` }}>
          <span className="sx-row-id">
            <span className="mono dim" style={{ width: 16 }}>
              {i + 1}
            </span>
            <TokenAvatar src={r.logoUrl} symbol={r.symbol} seed={r.token} size={30} />
            <span style={{ minWidth: 0 }}>
              <b>
                {r.symbol} {i < 3 && "🔥"}
              </b>
              <div className="dim">{r.name}</div>
            </span>
          </span>
          <span className="mono" style={{ textAlign: "right" }}>
            <Flash value={r.mcapUsd}>{r.mcapUsd !== null ? fmtUsd(r.mcapUsd, { compact: true }) : "—"}</Flash>
            <div className="dim" style={{ fontSize: 11 }}>
              mcap
            </div>
          </span>
          <span className="mono up" style={{ textAlign: "right", minWidth: 64 }}>
            {fmtUsd(r.vol30mUsd, { compact: true })}
            <div className="dim" style={{ fontSize: 11 }}>
              vol
            </div>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Who on X is talking about Robinhood Chain tokens right now, biggest accounts flagged. */
export function LiveSocial({ limit = 6, onOpen }: { limit?: number; onOpen?: Open }) {
  const { data } = usePoll<SocialSnapshot>(`/api/social?limit=${limit * 3}`, 30_000);
  const now = useNow();
  // Token posts first; ecosystem chatter from big accounts fills the rest.
  const posts = data ? [...data.posts.filter((p) => p.tokens.length), ...data.posts.filter((p) => !p.tokens.length)].slice(0, limit) : [];
  return (
    <div className="sx-card">
      <div className="sx-card-head">
        <span>On X · who&apos;s talking</span>
        <span className="sx-live-tag">
          <span className="dot live" /> live
        </span>
      </div>
      {!data && <Skeleton n={4} />}
      {data && !data.enabled && <div className="dim">The X radar is off on this server.</div>}
      {data?.enabled && posts.length === 0 && <div className="dim">Listening to X for Robinhood Chain tokens…</div>}
      {posts.map((p) => (
        <a key={p.id} className="sx-post" href={p.url} target="_blank" rel="noreferrer noopener">
          {p.author.avatar ? <img className="sx-post-av" src={p.author.avatar} alt="" width={30} height={30} /> : <span className="sx-post-av" />}
          <span className="sx-post-body">
            <span className="sx-post-head">
              <b>@{p.author.userName}</b>
              <span className={`sx-post-f ${p.author.followers >= 10_000 ? "big" : ""}`}>{compactCount(p.author.followers)}</span>
              <span className="dim">{fmtAgo(p.at, now)}</span>
              {p.tokens.slice(0, 2).map((t) => (
                <button
                  key={t.token}
                  className="sx-post-tok"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen?.(t.token);
                  }}
                >
                  ${t.symbol}
                </button>
              ))}
            </span>
            <span className="sx-post-text">{p.text}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

/** Brand-new launches, seconds after they are deployed. */
export function LiveLaunches({ limit = 5, onOpen }: { limit?: number; onOpen?: Open }) {
  const { data } = usePoll<ExplorePage>(`/api/explore?tab=new&limit=${limit}`, 8_000);
  const now = useNow();
  return (
    <div className="sx-card">
      <div className="sx-card-head">
        <span>Fresh launches · Pons</span>
        <span className="sx-live-tag">
          <span className="dot live" /> live
        </span>
      </div>
      {(!data || data.scanned === 0) && <Skeleton n={limit} />}
      {data?.rows.map((r, i) => (
        <div key={r.token} className="sx-row" role={onOpen ? "button" : undefined} onClick={() => onOpen?.(r.token)} style={{ cursor: onOpen ? "pointer" : undefined, animationDelay: `${i * 60}ms` }}>
          <span className="sx-row-id">
            <TokenAvatar src={r.logoUrl} symbol={r.symbol} seed={r.token} size={30} />
            <span style={{ minWidth: 0 }}>
              <b>{r.symbol}</b>
              <div className="dim">{r.launchedAt ? `${fmtAgo(r.launchedAt, now)} old` : r.name}</div>
            </span>
          </span>
          <span className="mono" style={{ textAlign: "right" }}>
            <Flash value={r.mcapUsd}>{r.mcapUsd !== null ? fmtUsd(r.mcapUsd, { compact: true }) : "—"}</Flash>
            <div className="dim" style={{ fontSize: 11 }}>
              mcap
            </div>
          </span>
          <span className="sx-bond" title={`${r.progressPct.toFixed(1)}% bonded`}>
            <span style={{ width: `${Math.min(100, Math.max(2, r.progressPct))}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A marquee of what is trending on Pons right now. */
export function TrendingTape() {
  const { data } = usePoll<ExplorePage>("/api/explore?tab=trending&limit=20", 20_000);
  const rows = data?.rows.filter((r) => r.vol30mUsd > 0) ?? [];
  if (!rows.length) {
    return (
      <div className="ticker">
        <div className="ticker-track" style={{ animation: "none" }}>
          <span className="tick muted">Scanning Pons launches…</span>
        </div>
      </div>
    );
  }
  // Duplicated so the marquee wraps seamlessly at -50%.
  const loop = [...rows, ...rows];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {loop.map((r, i) => (
          <span className="tick" key={`${r.token}-${i}`}>
            <TokenAvatar src={r.logoUrl} symbol={r.symbol} seed={r.token} size={18} />
            <b>{r.symbol}</b>
            <span className="mono">{r.mcapUsd !== null ? fmtUsd(r.mcapUsd, { compact: true }) : "—"}</span>
            <span className={`mono ${r.net30mUsd >= 0 ? "up" : "down"}`}>
              {r.net30mUsd >= 0 ? "▲" : "▼"} {fmtUsd(r.vol30mUsd, { compact: true })}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The busiest Stock Tokens, prices ticking live. */
export function LiveMarkets({ limit = 5, onOpen }: { limit?: number; onOpen?: Open }) {
  const { data } = usePoll<{ tokens: TokenMarket[] }>("/api/market", 20_000);
  const rows = (data?.tokens ?? [])
    .filter((t) => t.venue !== "pons")
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, limit);
  return (
    <div className="sx-card">
      <div className="sx-card-head">
        <span>Stock Tokens · 24/7 on chain</span>
        <span className="sx-live-tag">
          <span className="dot live" /> live
        </span>
      </div>
      {!data && <Skeleton n={limit} />}
      {rows.map((t, i) => (
        <div key={t.token.address} className="sx-row" role={onOpen ? "button" : undefined} onClick={() => onOpen?.(t.token.address)} style={{ cursor: onOpen ? "pointer" : undefined, animationDelay: `${i * 60}ms` }}>
          <span className="sx-row-id">
            <TokenAvatar src={t.token.logoUrl} symbol={t.token.symbol} seed={t.token.address} size={30} />
            <span style={{ minWidth: 0 }}>
              <b>{t.token.symbol}</b>
              <div className="dim">{t.token.name}</div>
            </span>
          </span>
          <Flash value={t.priceUsd} className="mono">
            ${fmtPrice(t.priceUsd)}
          </Flash>
          <span className={`mono ${t.priceChange24hPct === null ? "dim" : t.priceChange24hPct >= 0 ? "up" : "down"}`} style={{ minWidth: 64, textAlign: "right" }}>
            {fmtPct(t.priceChange24hPct)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Launches closest to graduating, plus a real safety read on the hottest one. */
export function LiveScan({ onOpen }: { onOpen?: Open }) {
  const { data: almost } = usePoll<ExplorePage>("/api/explore?tab=almost&limit=4", 15_000);
  const { data: hot } = usePoll<ExplorePage>("/api/explore?tab=trending&limit=1", 30_000);
  const target = hot?.rows[0]?.token;
  const [detail, setDetail] = useState<PonsTokenDetail | null>(null);
  useEffect(() => {
    if (!target) return;
    let alive = true;
    fetch(`/api/pons/token?address=${target}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && !("error" in d) && setDetail(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [target]);
  return (
    <div className="sx-card">
      <div className="sx-card-head">
        <span>About to graduate</span>
        <span className="sx-live-tag">
          <span className="dot live" /> scanning
        </span>
      </div>
      {(!almost || almost.scanned === 0) && <Skeleton n={4} />}
      {almost?.rows.map((r) => (
        <div key={r.token} className="sx-row" role={onOpen ? "button" : undefined} onClick={() => onOpen?.(r.token)} style={{ cursor: onOpen ? "pointer" : undefined }}>
          <span className="sx-row-id">
            <TokenAvatar src={r.logoUrl} symbol={r.symbol} seed={r.token} size={28} />
            <b>{r.symbol}</b>
          </span>
          <span className="sx-bond">
            <span style={{ width: `${Math.min(100, r.progressPct)}%` }} />
          </span>
          <span className="mono" style={{ minWidth: 48, textAlign: "right" }}>
            {r.progressPct.toFixed(0)}%
          </span>
        </div>
      ))}
      {detail && (
        <div className="sx-safety">
          <span className="ring" style={{ ["--s" as string]: detail.safety.score }}>
            {detail.safety.score}
          </span>
          <div>
            <b>
              {detail.market.token.symbol} · {detail.safety.label}
            </b>
            <div className="sx-flags" style={{ marginTop: 6 }}>
              {detail.safety.flags.slice(0, 3).map((f) => (
                <span key={f.text} style={f.tone === "good" ? undefined : { color: f.tone === "bad" ? "var(--red)" : "var(--warn)", background: f.tone === "bad" ? "var(--red-dim)" : "var(--warn-dim)" }}>
                  {f.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
