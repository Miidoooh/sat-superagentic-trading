"use client";

import { useEffect, useRef, useState } from "react";
import type { PicksResult } from "@/lib/agent/picks";
import type { Pick } from "@/lib/agent/strategy";
import type { TrackStats } from "@/lib/agent/track";
import { fmtUsd } from "@/lib/format";
import Satellite from "../brand/Satellite";
import { setMood } from "../brand/mood";
import { executeTrade } from "../tradeExec";
import { usePoll } from "../usePoll";
import { useWallet } from "../wallet";
import { useTelegramLink } from "../alertStore";
import { useAgentStyle, useAgentTelegram, usePositions, type PresetId } from "./agentStore";
import PickCard, { type BuyState } from "./PickCard";
import Positions from "./Positions";
import StyleEditor from "./StyleEditor";

const PICKS_MS = 20_000;

const PRESETS: { id: PresetId; emoji: string; name: string; blurb: string }[] = [
  { id: "sniper", emoji: "🎯", name: "Sniper", blurb: "Fresh launches under $15K with real buyers and socials. In early, out fast." },
  { id: "momentum", emoji: "🚀", name: "Momentum", blurb: "Tokens where volume, buyers and net buying are all climbing right now." },
  { id: "graduation", emoji: "🎓", name: "Graduation play", blurb: "Curves 60–99% bonded with steady buying, before they hit Uniswap." },
  { id: "whale", emoji: "🐋", name: "Whale shadow", blurb: "Follow the big money: $3K+ net buying in 30 minutes, safety checked." },
];

interface Props {
  agentEnabled: boolean;
  onOpenToken: (token: string) => void;
}

function TrackLine({ t }: { t?: TrackStats }) {
  if (!t || t.picks === 0) return <span className="dim">Building its 24h record…</span>;
  return (
    <span>
      <b>{t.picks}</b> picks · <b className="up">{t.hit2x}</b> hit 2×{t.best ? ` · best ${t.best.symbol} ${t.best.x}×` : ""}
    </span>
  );
}

/** Your agent: pick or describe a style, get live picks with exact plans, and track them to the exit. */
export default function AgentView({ agentEnabled, onOpenToken }: Props) {
  const { style, strategy, setStyle } = useAgentStyle();
  const { open } = usePositions();
  const telegram = useAgentTelegram();
  const { link } = useTelegramLink();
  const tgLinked = !!link?.token;
  const wallet = useWallet();
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState<(PicksResult & { track: TrackStats | null }) | null>(null);
  const [error, setError] = useState("");
  const [buys, setBuys] = useState<Record<string, BuyState>>({});
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const { data: track } = usePoll<{ styles: TrackStats[] }>("/api/agent/track", 60_000);
  const body = JSON.stringify(style.kind === "preset" ? { preset: style.preset } : { strategy: style.strategy });

  useEffect(() => {
    let alive = true;
    seen.current = null;
    setData(null);
    const load = () =>
      fetch("/api/agent/picks", { method: "POST", headers: { "content-type": "application/json" }, body })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? "The agent could not scan right now");
          return d as PicksResult & { track: TrackStats | null };
        })
        .then((d) => {
          if (!alive) return;
          const tokens = new Set(d.picks.map((p) => p.token));
          if (seen.current) {
            const added = [...tokens].filter((t) => !seen.current!.has(t));
            if (added.length) {
              setFresh(new Set(added));
              setMood("pump");
            }
          }
          seen.current = new Set([...(seen.current ?? []), ...tokens]);
          setData(d);
          setError("");
        })
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const t = setInterval(load, PICKS_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [body]);

  async function buy(p: Pick) {
    const set = (s: BuyState) => setBuys((b) => ({ ...b, [p.token]: s }));
    if (!p.payUsd) return set({ text: "No price for this token's pair right now.", tone: "bad" });
    const amount = Number((p.plan.buyUsd / p.payUsd).toPrecision(3));
    set({ text: "Preparing…", busy: true });
    try {
      const built = await executeTrade({ side: "buy", token: p.token, amount }, wallet, (text, href) => set({ text, href, busy: true }));
      open({ token: p.token, symbol: p.symbol, openedAt: Math.floor(Date.now() / 1000), plan: p.plan, hit: [], peakMcap: p.mcapUsd });
      set({ text: `Bought ≥ ${built.minOut}. Tracking your plan →`, tone: "ok" });
      setMood("pump");
    } catch (e) {
      const msg = (e as Error).message;
      set({ text: /user rejected|denied/i.test(msg) ? "Cancelled in wallet." : msg, tone: "bad" });
    }
  }

  const statsFor = (id: PresetId) => track?.styles.find((s) => s.style === id);
  const isCustom = style.kind === "custom";

  return (
    <div className="live ag">
      <section className="ag-hero">
        <Satellite mood={data?.picks.length ? "pump" : "scanning"} size={120} />
        <div>
          <div className="sat-kicker">Your agent</div>
          <h1>
            Hunting with <em>{strategy.name}</em>
          </h1>
          <p className="muted">
            SAT scans every launch on Pons and Uniswap around the clock and tells you what fits your style: what to buy, at what market cap, and exactly when to sell.
            You sign every trade.
          </p>
          <div className="ag-status mono">
            <span className="dot live" />{" "}
            {data ? `${data.scanned.toLocaleString("en-US")} launches scanned · ${data.picks.length} fit your style` : error || "Scanning launches…"}
          </div>
        </div>
      </section>

      <section className="ag-styles">
        {PRESETS.map((p) => (
          <button key={p.id} className={`ag-style ${style.kind === "preset" && style.preset === p.id ? "on" : ""}`} onClick={() => setStyle({ kind: "preset", preset: p.id })}>
            <span className="ag-style-emoji">{p.emoji}</span>
            <b>{p.name}</b>
            <span className="dim">{p.blurb}</span>
            <span className="ag-track">
              <TrackLine t={statsFor(p.id)} />
            </span>
          </button>
        ))}
        <button className={`ag-style custom ${isCustom ? "on" : ""}`} onClick={() => setEditing(true)}>
          <span className="ag-style-emoji">✍️</span>
          <b>{isCustom ? strategy.name : "My style"}</b>
          <span className="dim">{isCustom ? "Your own filters and exits. Tap to tune." : "Describe how you trade in plain words, or set every number yourself."}</span>
          <span className="ag-track">{isCustom ? "Active" : "Build yours →"}</span>
        </button>
      </section>

      {editing && (
        <section className="ag-card">
          <div className="ag-card-head">
            <b>Build your style</b>
            <span className="dim">Starts from {strategy.name}. Every number is yours to change.</span>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={() => setEditing(false)}>
              Close
            </button>
          </div>
          <StyleEditor
            key={JSON.stringify(strategy)}
            strategy={strategy}
            agentEnabled={agentEnabled}
            onSave={(s) => {
              setStyle({ kind: "custom", strategy: s });
              setEditing(false);
            }}
          />
        </section>
      )}

      <div className="ag-grid">
        <section>
          <div className="ag-col-head">
            <b>Picks for your style</b>
            <span className="dim">refreshes every 20s</span>
            <div className="spacer" />
            {!editing && (
              <button className="btn ghost sm" onClick={() => setEditing(true)}>
                Tune filters
              </button>
            )}
          </div>
          {!data && !error && (
            <div className="ag-picks">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="ag-pick skeleton" style={{ height: 210 }} />
              ))}
            </div>
          )}
          {error && !data && <div className="banner error">{error}</div>}
          {data && data.picks.length === 0 && (
            <div className="ag-none">
              <Satellite mood="scanning" size={90} orbit={false} />
              <div>
                <b>Nothing fits {strategy.name} right now.</b>
                <p className="dim">
                  SAT keeps scanning {data.scanned.toLocaleString("en-US")} launches. Picks show up here the moment one matches. Loosen a filter to see more.
                </p>
              </div>
            </div>
          )}
          <div className="ag-picks">
            {data?.picks.map((p, i) => (
              <div key={p.token} className={fresh.has(p.token) ? "ag-fresh" : ""}>
                <PickCard pick={p} rank={i} buy={buys[p.token]} onBuy={(x) => void buy(x)} onOpen={onOpenToken} />
              </div>
            ))}
          </div>
        </section>
        <aside>
          <div className="ag-col-head">
            <b>Your plan tracker</b>
            <span className="dim">exits checked every 15s</span>
          </div>
          <Positions onOpen={onOpenToken} />
          <div className="ag-card ag-explain">
            <label className="ag-field check" style={{ paddingTop: 0, marginBottom: 10 }}>
              <input type="checkbox" checked={telegram.enabled} onChange={(e) => telegram.setEnabled(e.target.checked)} />
              <span>Send new picks to my Telegram, 24/7</span>
            </label>
            <p className="dim" style={{ marginTop: 0 }}>
              {tgLinked ? "Linked. Your agent posts each new pick with its plan." : "Link Telegram in 🔔 alerts and your agent keeps hunting while you sleep."}
            </p>
            <b>How autopilot works today</b>
            <p className="dim">
              Your agent finds the entries and watches your exits. When a target or stop hits, it tells you and the sell is one tap. Your keys never leave your wallet.
              Fully automatic trading with a capped agent wallet is next.
            </p>
            <p className="dim">Buy size {fmtUsd(strategy.buyUsd)} per pick. Picks and plans are heuristics, not advice.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
