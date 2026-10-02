"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { checkExit, type ExitSignal } from "@/lib/agent/strategy";
import { fmtUsd } from "@/lib/format";
import { setMood } from "../brand/mood";
import { executeTrade } from "../tradeExec";
import { useWallet } from "../wallet";
import { usePositions, type StoredPosition } from "./agentStore";

const MARKS_MS = 15_000;
const money = (n: number) => fmtUsd(n, { compact: true });

type Marks = Record<string, { mcapUsd: number; priceUsd: number }>;

/** Positions opened from picks, marked live against their plans, with one-tap exits. */
export default function Positions({ onOpen }: { onOpen: (token: string) => void }) {
  const { positions, update, remove } = usePositions();
  const wallet = useWallet();
  const open = useMemo(() => positions.filter((p) => !p.closed), [positions]);
  const [marks, setMarks] = useState<Marks>({});
  const [status, setStatus] = useState<Record<string, { text: string; tone?: "ok" | "bad"; busy?: boolean }>>({});
  const signalled = useRef(new Set<string>());
  const tokens = open.map((p) => p.token.toLowerCase()).join(",");

  useEffect(() => {
    if (!tokens) return;
    let alive = true;
    const load = () =>
      fetch(`/api/agent/marks?tokens=${tokens}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { marks: Marks } | null) => alive && d && setMarks(d.marks))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, MARKS_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tokens]);

  // Keep each position's peak so trailing stops measure from the real top.
  useEffect(() => {
    for (const p of open) {
      const m = marks[p.token.toLowerCase()]?.mcapUsd;
      if (m && m > p.peakMcap) update(p.token, { peakMcap: m });
    }
  }, [marks, open, update]);

  const now = Math.floor(Date.now() / 1000);
  const signals = new Map<string, ExitSignal | null>();
  for (const p of open) {
    const m = marks[p.token.toLowerCase()]?.mcapUsd;
    signals.set(p.token, m ? checkExit(p, m, now) : null);
  }

  useEffect(() => {
    for (const [token, s] of signals) {
      if (!s) continue;
      const key = `${token}:${s.kind}:${s.target ?? ""}`;
      if (signalled.current.has(key)) continue;
      signalled.current.add(key);
      setMood(s.kind === "take-profit" ? "pump" : "scanning");
    }
  });

  async function sell(p: StoredPosition, s: ExitSignal) {
    const set = (v: { text: string; tone?: "ok" | "bad"; busy?: boolean }) => setStatus((x) => ({ ...x, [p.token]: v }));
    try {
      const account = wallet.address ?? (await wallet.connect());
      if (!account) throw new Error("Connect a wallet to sell.");
      set({ text: "Reading your balance…", busy: true });
      const bal = await wallet.reader.readContract({ address: p.token as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [account] });
      const held = Number(formatUnits(bal, 18));
      if (held <= 0) throw new Error(`This wallet holds no ${p.symbol}.`);
      const share = s.kind === "take-profit" ? Math.min(1, s.sellPct / remainingPct(p)) : 1;
      const amount = Math.floor(held * share * 1e6) / 1e6;
      await executeTrade({ side: "sell", token: p.token as `0x${string}`, amount }, wallet, (text) => set({ text, busy: true }));
      if (s.kind === "take-profit" && s.target !== undefined && share < 1) update(p.token, { hit: [...p.hit, s.target] });
      else update(p.token, { closed: true, hit: p.plan.targets.map((_, i) => i) });
      set({ text: `Sold ${amount.toLocaleString("en-US")} ${p.symbol}.`, tone: "ok" });
      setMood("pump");
    } catch (e) {
      const msg = (e as Error).message;
      set({ text: /user rejected|denied/i.test(msg) ? "Cancelled in wallet." : msg, tone: "bad" });
    }
  }

  if (open.length === 0) {
    return <div className="dim ag-empty">Buy a pick with “Buy & track plan” and SAT watches it here, telling you the moment your plan says sell.</div>;
  }

  return (
    <div className="ag-positions">
      {open.map((p) => {
        const m = marks[p.token.toLowerCase()];
        const x = m ? m.mcapUsd / p.plan.entryMcap : null;
        const s = signals.get(p.token) ?? null;
        const st = status[p.token];
        return (
          <div key={p.token} className={`ag-pos ${s ? `signal ${s.kind}` : ""}`}>
            <div className="ag-pos-main" role="button" tabIndex={0} onClick={() => onOpen(p.token)} onKeyDown={(e) => e.key === "Enter" && onOpen(p.token)}>
              <b>{p.symbol}</b>
              <span className="dim mono">in at {money(p.plan.entryMcap)}</span>
              <span className={`mono ${x === null ? "dim" : x >= 1 ? "up" : "down"}`}>{x === null ? "…" : `${x.toFixed(2)}×`}</span>
              <span className="dim mono">{m ? `now ${money(m.mcapUsd)}` : ""}</span>
            </div>
            <div className="ag-pos-plan">
              {p.plan.targets.map((t, i) => (
                <span key={t.atX} className={p.hit.includes(i) ? "done" : x !== null && x >= t.atX ? "due" : ""}>
                  {t.sellPct}% @ {t.atX}×
                </span>
              ))}
              <span className={x !== null && m && m.mcapUsd <= p.plan.stop.mcap ? "due bad" : "stop"}>stop {money(p.plan.stop.mcap)}</span>
            </div>
            {s && (
              <div className="ag-signal">
                <span>{s.reason}</span>
                <button className="btn sm primary" disabled={st?.busy} onClick={() => void sell(p, s)}>
                  Sell {s.sellPct}% now
                </button>
              </div>
            )}
            {st && <div className={`ag-buy-status ${st.tone ?? ""}`}>{st.text}</div>}
            <button className="ag-pos-x" title="Stop tracking" onClick={() => remove(p.token)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function remainingPct(p: StoredPosition): number {
  return Math.max(1, 100 - p.plan.targets.reduce((sum, t, i) => sum + (p.hit.includes(i) ? t.sellPct : 0), 0));
}
