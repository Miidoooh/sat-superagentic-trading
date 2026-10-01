"use client";

import { useState } from "react";
import type { TradeProposal } from "@/lib/agent/tools";
import { fmtUsd } from "@/lib/format";
import { executeTrade } from "./tradeExec";
import { useWallet, type ChainInfo } from "./wallet";

export type { ChainInfo };

interface Props {
  proposal: TradeProposal;
  chain: ChainInfo | null;
  executionEnabled: boolean;
}

type Status = "idle" | "working" | "done" | "error";

export default function TradeCard({ proposal: p, executionEnabled }: Props) {
  const wallet = useWallet();
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<{ text: string; href?: string }[]>([]);

  const push = (text: string, href?: string) => setLog((l) => [...l, { text, href }]);

  async function execute() {
    setStatus("working");
    setLog([]);
    try {
      await executeTrade(p.intent, wallet, push);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      push((err as Error).message);
    }
  }

  const busy = status === "working";
  return (
    <div className={`artifact ${p.ok ? "" : "bad"}`}>
      <div className="artifact-head">
        <span className={`pill ${p.intent.side === "buy" ? "ok" : "warn"}`}>{p.intent.side}</span>
        <b>{p.symbol}</b>
        <div className="spacer" />
        <span className="dim">needs your approval</span>
      </div>
      <div className="artifact-body">
        {p.intent.rationale && <div className="muted">{p.intent.rationale}</div>}
        {p.preview && (
          <>
            <div className="kv">
              <span className="k">You pay</span>
              <span className="mono">{p.preview.amountIn}</span>
            </div>
            <div className="kv">
              <span className="k">Estimated out</span>
              <span className="mono">{p.preview.estimatedOut}</span>
            </div>
            <div className="kv">
              <span className="k">Minimum out</span>
              <span className="mono">{p.preview.minOut}</span>
            </div>
            <div className="kv">
              <span className="k">Max slippage</span>
              <span className="mono">{p.preview.slippageBps} bps</span>
            </div>
            <div className="kv">
              <span className="k">Notional</span>
              <span className="mono">{fmtUsd(p.preview.notionalUsd)}</span>
            </div>
          </>
        )}
        {p.errors.map((e) => (
          <div key={e} className="down">
            Blocked: {e}
          </div>
        ))}
        {p.preview?.warnings.map((w) => (
          <div key={w} className="dim">
            {w}
          </div>
        ))}
        {p.ok && executionEnabled && (
          <button className="btn primary" disabled={busy || status === "done"} onClick={execute}>
            {status === "done"
              ? "Done"
              : busy
                ? "Waiting on wallet…"
                : !wallet.address
                  ? "Connect wallet & sign"
                  : status === "error"
                    ? "Retry in wallet"
                    : "Review & sign in wallet"}
          </button>
        )}
        {p.ok && !executionEnabled && (
          <div className="dim">Trading is disabled on this deployment, so this stays a proposal.</div>
        )}
        {log.length > 0 && (
          <div className="steps">
            {log.map((l, i) => (
              <div className="step" key={i}>
                {l.href ? (
                  <a href={l.href} target="_blank" rel="noreferrer noopener" className="link-sym">
                    {l.text} ↗
                  </a>
                ) : (
                  l.text
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
