"use client";

import { useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, type EIP1193Provider } from "viem";
import type { TradeProposal } from "@/lib/agent/tools";
import type { BuiltTrade } from "@/lib/trade/trade";
import { fmtUsd } from "@/lib/format";

export interface ChainInfo {
  id: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  symbol: string;
}

interface Props {
  proposal: TradeProposal;
  chain: ChainInfo | null;
  executionEnabled: boolean;
}

type Status = "idle" | "building" | "signing" | "done" | "error";

export default function TradeCard({ proposal: p, chain, executionEnabled }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<{ text: string; href?: string }[]>([]);

  const push = (text: string, href?: string) => setLog((l) => [...l, { text, href }]);

  async function execute() {
    if (!chain) return;
    const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!ethereum) {
      setStatus("error");
      push("No browser wallet found. Install a wallet that supports EIP-1193.");
      return;
    }
    try {
      setStatus("building");
      const viemChain = defineChain({
        id: chain.id,
        name: chain.name,
        nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
        rpcUrls: { default: { http: [chain.rpcUrl] } },
        blockExplorers: { default: { name: "Explorer", url: chain.explorer } },
      });
      const wallet = createWalletClient({ chain: viemChain, transport: custom(ethereum) });
      const [account] = await wallet.requestAddresses();
      try {
        await wallet.switchChain({ id: chain.id });
      } catch {
        await wallet.addChain({ chain: viemChain });
        await wallet.switchChain({ id: chain.id });
      }

      // The server re-checks every guardrail and returns the calldata to sign.
      const res = await fetch("/api/trade/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: p.intent, wallet: account }),
      });
      const built = (await res.json()) as BuiltTrade | { error: string };
      if (!res.ok || "error" in built) throw new Error("error" in built ? built.error : "Build failed");

      setStatus("signing");
      const publicClient = createPublicClient({ chain: viemChain, transport: custom(ethereum) });
      for (const step of built.steps) {
        push(`Confirm in wallet: ${step.label}`);
        const hash = await wallet.sendTransaction({
          account,
          chain: viemChain,
          to: step.to,
          data: step.data,
          value: BigInt(step.value),
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
        push(`Confirmed ${hash.slice(0, 10)}…`, `${chain.explorer}/tx/${hash}`);
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      push((err as Error).message);
    }
  }

  const busy = status === "building" || status === "signing";
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
