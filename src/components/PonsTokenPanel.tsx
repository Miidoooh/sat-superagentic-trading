"use client";

import { useEffect, useState } from "react";
import { ponsTokenUrl } from "@/lib/chain/constants";
import { fmtAgo, fmtPrice, fmtUsd } from "@/lib/format";
import type { PonsTokenDetail } from "@/lib/data/ponsToken";
import type { SafetyScore } from "@/lib/safety/score";
import { shortAddr } from "./follows";
import { usePoll } from "./usePoll";

interface Props {
  token: string;
  explorer: string;
  onWallet: (address: string) => void;
}

function SafetyCard({ safety }: { safety: SafetyScore }) {
  return (
    <div className={`safety ${safety.grade}`}>
      <div className="safety-gauge" style={{ ["--score" as string]: safety.score }}>
        <span className="mono">{safety.score}</span>
      </div>
      <div className="safety-body">
        <div className="safety-head">
          <strong>{safety.label}</strong>
          <span className="dim">SAT safety score · from on-chain history</span>
        </div>
        <ul className="safety-flags">
          {safety.flags.map((f) => (
            <li key={f.text} className={f.tone}>
              {f.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Curve progress, trade tape and holders for one Pons launch. */
export default function PonsTokenPanel({ token, explorer, onWallet }: Props) {
  const { data, error } = usePoll<PonsTokenDetail>(`/api/pons/token?address=${token}`, 10_000);
  const [tab, setTab] = useState<"trades" | "holders">("trades");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(t);
  }, []);

  if (error && !data) return <div className="banner">{error}</div>;
  if (!data) return <div className="dim live-empty pons-panel">Reading trades and holders from the curve…</div>;

  const curve = data.market.curve;
  const s = data.stats;
  const buyShare = s.buyUsd + s.sellUsd > 0 ? s.buyUsd / (s.buyUsd + s.sellUsd) : 0.5;

  return (
    <div className="pons-panel">
      {data.safety && <SafetyCard safety={data.safety} />}
      <div className="trench-stats">
        {curve && (
          <div className="quote grow">
            <span className="k">
              Graduation <b className="mono">{curve.progressPct.toFixed(1)}%</b> · {fmtUsd(curve.raisedUsd, { compact: true })} of{" "}
              {fmtUsd(curve.thresholdUsd, { compact: true })}
            </span>
            <div className={`curve-progress ${curve.progressPct >= 80 ? "hot" : curve.progressPct >= 40 ? "warm" : ""}`}>
              <span style={{ width: `${Math.min(100, Math.max(2, curve.progressPct))}%` }} />
            </div>
          </div>
        )}
        <div className="quote grow">
          <span className="k">
            Since launch · buys <b className="up">{fmtUsd(s.buyUsd, { compact: true })}</b> · sells{" "}
            <b className="down">{fmtUsd(s.sellUsd, { compact: true })}</b>
          </span>
          <div className="pressure-bar">
            <span className="up-fill" style={{ width: `${buyShare * 100}%` }} />
          </div>
        </div>
        <div className="quote">
          <span className="k">Traders</span>
          <span className="v mono">{s.traders}</span>
        </div>
        <div className="quote">
          <span className="k">Holders</span>
          <span className="v mono">{data.holderCount}</span>
        </div>
        <div className="quote">
          <span className="k">Launched</span>
          <span className="v mono">{fmtAgo(data.launchedAt, now)} ago</span>
        </div>
        <a className="btn sm primary" href={ponsTokenUrl(token)} target="_blank" rel="noreferrer noopener">
          Trade on Pons ↗
        </a>
      </div>

      <div className="live-sub pons-tabs">
        <div className="tfs">
          <button className={`tf ${tab === "trades" ? "active" : ""}`} onClick={() => setTab("trades")}>
            Trades
          </button>
          <button className={`tf ${tab === "holders" ? "active" : ""}`} onClick={() => setTab("holders")}>
            Top holders
          </button>
        </div>
        <span className="dim">
          deployer{" "}
          <button className="link mono" onClick={() => onWallet(data.deployer)}>
            {shortAddr(data.deployer)}
          </button>
        </span>
      </div>

      {tab === "trades" ? (
        <div className="trade-rows pons-rows">
          {data.trades.length === 0 && <div className="dim live-empty">No trades yet.</div>}
          {data.trades.map((t) => (
            <div key={t.id} className={`trade-row compact ${t.side}`}>
              <span className={`side-badge ${t.side}`}>{t.side === "buy" ? "BUY" : "SELL"}</span>
              <span className="mono">${fmtPrice(t.priceUsd)}</span>
              <span className={`mono trade-usd ${t.side === "buy" ? "up" : "down"}`}>{fmtUsd(t.usd, { compact: t.usd >= 10_000 })}</span>
              {t.trader ? (
                <button className="link mono trade-wallet" onClick={() => onWallet(t.trader!)}>
                  {shortAddr(t.trader)}
                </button>
              ) : (
                <span className="dim mono trade-wallet">router</span>
              )}
              <a className="dim mono trade-age" href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer noopener">
                {fmtAgo(t.time, now)} ↗
              </a>
            </div>
          ))}
        </div>
      ) : (
        <div className="trade-rows pons-rows">
          {data.holders.map((h, i) => (
            <div key={h.address} className="holder-row">
              <span className="dim mono">{i + 1}</span>
              <button className="link mono" onClick={() => onWallet(h.address)}>
                {shortAddr(h.address)}
              </button>
              {h.label && <span className={`venue-tag ${h.label === "curve" ? "pons" : ""}`}>{h.label}</span>}
              <span className="holder-bar">
                <span style={{ width: `${Math.min(100, h.pct)}%` }} />
              </span>
              <span className="mono">{h.pct.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
