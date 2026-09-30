"use client";

import { useEffect, useState } from "react";
import { fmtAgo, fmtPrice, fmtUsd } from "@/lib/format";
import type { GraduatedCard, TrenchCard, TrenchesSnapshot } from "@/lib/radar/trenches";
import { usePoll } from "./usePoll";

interface Props {
  explorer: string;
  /** Opens the token in the terminal if it is listed there, otherwise on Pons. */
  onOpenToken: (token: string, url: string) => void;
}

function Progress({ pct }: { pct: number }) {
  const tone = pct >= 80 ? "hot" : pct >= 40 ? "warm" : "";
  return (
    <div className={`curve-progress ${tone}`} title={`${pct.toFixed(1)}% of the graduation target raised`}>
      <span style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

function Card({ c, now, onOpen }: { c: TrenchCard; now: number; onOpen: Props["onOpenToken"] }) {
  const net = c.flow.buyUsd - c.flow.sellUsd;
  return (
    <button className="trench-card" onClick={() => onOpen(c.token, c.url)} title={c.name || c.symbol}>
      <div className="trench-top">
        <span className="trench-sym">{c.symbol}</span>
        <span className="dim mono">{fmtAgo(c.launchedAt, now)}</span>
      </div>
      <div className="trench-mid">
        <span className="mono">${fmtPrice(c.priceUsd)}</span>
        <span className="dim">{c.quoteSymbol}</span>
      </div>
      <Progress pct={c.progressPct} />
      <div className="trench-bot">
        <span className="mono">{c.progressPct.toFixed(1)}%</span>
        <span className="dim mono">
          {fmtUsd(c.raisedUsd, { compact: true })} / {fmtUsd(c.thresholdUsd, { compact: true })}
        </span>
      </div>
      {c.flow.trades > 0 && (
        <div className="trench-flow">
          <span className="up mono">+{fmtUsd(c.flow.buyUsd, { compact: true })}</span>
          <span className="down mono">−{fmtUsd(c.flow.sellUsd, { compact: true })}</span>
          <span className={`mono ${net >= 0 ? "up" : "down"}`}>
            net {net >= 0 ? "+" : "−"}
            {fmtUsd(Math.abs(net), { compact: true })}
          </span>
        </div>
      )}
    </button>
  );
}

function Column({ title, hint, cards, now, onOpen }: { title: string; hint: string; cards: TrenchCard[]; now: number; onOpen: Props["onOpenToken"] }) {
  return (
    <div className="trench-col">
      <div className="live-sub">
        {title} <span className="dim">{hint}</span>
      </div>
      <div className="trench-list">
        {cards.length === 0 && <div className="dim live-empty">Nothing here yet</div>}
        {cards.map((c) => (
          <Card key={c.curve} c={c} now={now} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function GraduatedColumn({ cards, now, explorer }: { cards: GraduatedCard[]; now: number; explorer: string }) {
  return (
    <div className="trench-col">
      <div className="live-sub">
        Graduated <span className="dim">now on Uniswap</span>
      </div>
      <div className="trench-list">
        {cards.length === 0 && <div className="dim live-empty">No graduations in the last day</div>}
        {cards.map((g) => (
          <div key={g.tx} className="trench-card graduated">
            <div className="trench-top">
              <a className="trench-sym" href={g.url} target="_blank" rel="noreferrer noopener">
                {g.symbol} ↗
              </a>
              <span className="dim mono">{fmtAgo(g.graduatedAt, now)}</span>
            </div>
            <div className="trench-mid">
              <span className="dim">pool seeded</span>
              <span className="mono">{fmtUsd(g.liquidityUsd, { compact: true })}</span>
            </div>
            <a className="dim mono" href={`${explorer}/tx/${g.tx}`} target="_blank" rel="noreferrer noopener">
              graduation tx ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PonsTrenches({ explorer, onOpenToken }: Props) {
  const { data, error, loading } = usePoll<TrenchesSnapshot>("/api/pons", 15_000);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, []);

  const s = data?.stats;
  const buyShare = s && s.buyUsd + s.sellUsd > 0 ? s.buyUsd / (s.buyUsd + s.sellUsd) : 0.5;

  return (
    <div className="live">
      <div className="live-head">
        <div>
          <div className="live-title">
            <span className="dot live" /> Pons Trenches
          </div>
          <div className="dim live-caption">
            Every launch on the Pons launchpad, read live from the factory and each bonding curve. A curve graduates to Uniswap when it raises its target.
          </div>
        </div>
      </div>

      {error && !data && <div className="banner error">Could not load the trenches: {error}</div>}

      {s && (
        <div className="trench-stats">
          <div className="quote">
            <span className="k">Launches · 1h</span>
            <span className="v mono">{s.launchesLastHour}</span>
          </div>
          <div className="quote">
            <span className="k">Graduations · 24h</span>
            <span className="v mono">{s.graduationsLastDay}</span>
          </div>
          <div className="quote">
            <span className="k">Curve trades · {data.windowMinutes}m</span>
            <span className="v mono">{s.curveTrades.toLocaleString("en-US")}</span>
          </div>
          <div className="quote">
            <span className="k">Active curves</span>
            <span className="v mono">{s.activeCurves}</span>
          </div>
          <div className="quote grow">
            <span className="k">
              Buys <b className="up">{fmtUsd(s.buyUsd, { compact: true })}</b> · Sells{" "}
              <b className="down">{fmtUsd(s.sellUsd, { compact: true })}</b>
            </span>
            <div className="pressure-bar">
              <span className="up-fill" style={{ width: `${buyShare * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="chart-empty is-loading">Reading launches and curves from Robinhood Chain…</div>
      ) : (
        data && (
          <div className="live-body trench-grid">
            <Column title="New launches" hint="just deployed" cards={data.newest} now={now} onOpen={onOpenToken} />
            <Column title="About to graduate" hint="closest to target" cards={data.graduating} now={now} onOpen={onOpenToken} />
            <Column title="Hot" hint={`most traded · ${data.windowMinutes}m`} cards={data.hot} now={now} onOpen={onOpenToken} />
            <GraduatedColumn cards={data.graduated} now={now} explorer={explorer} />
          </div>
        )
      )}
    </div>
  );
}
