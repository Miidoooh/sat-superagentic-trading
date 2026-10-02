"use client";

import { useState } from "react";
import { StrategySchema, type Strategy } from "@/lib/agent/strategy";

interface Props {
  strategy: Strategy;
  agentEnabled: boolean;
  onSave: (s: Strategy) => void;
}

type NumKey = "mcapMin" | "mcapMax" | "maxAgeMin" | "minProgressPct" | "maxProgressPct" | "minVol30mUsd" | "minNet30mUsd" | "minBuyers30m" | "minSafety" | "buyUsd" | "stopLossPct" | "trailingPct" | "maxHoldHours";

const FIELDS: { key: NumKey; label: string; hint: string; unit?: string }[] = [
  { key: "mcapMin", label: "Min market cap", hint: "USD", unit: "$" },
  { key: "mcapMax", label: "Max market cap", hint: "USD, blank for none", unit: "$" },
  { key: "maxAgeMin", label: "Max age", hint: "minutes since launch" },
  { key: "minBuyers30m", label: "Min wallets", hint: "trading in the last 30m" },
  { key: "minNet30mUsd", label: "Min net buying", hint: "USD in the last 30m", unit: "$" },
  { key: "minVol30mUsd", label: "Min volume", hint: "USD in the last 30m", unit: "$" },
  { key: "minProgressPct", label: "Min bonded", hint: "% of the curve" },
  { key: "maxProgressPct", label: "Max bonded", hint: "% of the curve" },
  { key: "minSafety", label: "Min safety", hint: "0 to 100, blank to skip" },
  { key: "buyUsd", label: "Buy size", hint: "USD per pick", unit: "$" },
  { key: "stopLossPct", label: "Stop loss", hint: "% below your entry" },
  { key: "trailingPct", label: "Trailing stop", hint: "% from the top, blank for none" },
  { key: "maxHoldHours", label: "Max hold", hint: "hours, blank for none" },
];

/** Describe a style in words, or tune every number by hand. */
export default function StyleEditor({ strategy, agentEnabled, onSave }: Props) {
  const [draft, setDraft] = useState<Strategy>(strategy);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone?: "bad" } | null>(null);

  const setNum = (key: NumKey, raw: string) => {
    const v = raw.trim() === "" ? undefined : Number(raw);
    setDraft((d) => ({ ...d, [key]: v === undefined || Number.isNaN(v) ? undefined : v }));
  };

  async function describe() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/agent/style", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not read that style");
      setDraft(d.strategy);
      setNote({ text: d.summary || "Here is your style. Check the numbers, then save." });
    } catch (e) {
      setNote({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const parsed = StrategySchema.safeParse({ ...draft, style: "custom", name: draft.name || "My style" });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setNote({ text: `${issue?.path.join(" ") || "Style"}: ${issue?.message}`, tone: "bad" });
      return;
    }
    onSave(parsed.data);
    setNote({ text: "Saved. Your agent now hunts with this style." });
  }

  return (
    <div className="ag-editor">
      <div className="ag-describe">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe how you trade. e.g. “I ape fresh launches under 15k mcap with socials and 20+ buyers, sell half at 2x, the rest at 5x, cut at -35%.”"
          rows={3}
          maxLength={600}
        />
        <button className="btn primary" disabled={!agentEnabled || busy || text.trim().length < 5} onClick={() => void describe()} title={agentEnabled ? "" : "Needs an agent key on the server"}>
          {busy ? "Reading your style…" : "Build my style"}
        </button>
      </div>

      <div className="ag-fields">
        <label className="ag-field wide">
          <span>Name</span>
          <input value={draft.name} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <label className="ag-field">
          <span>Stage</span>
          <select value={draft.stage} onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value as Strategy["stage"] }))}>
            <option value="curve">On the curve</option>
            <option value="graduated">Graduated (Uniswap)</option>
            <option value="any">Both</option>
          </select>
        </label>
        <label className="ag-field check">
          <input type="checkbox" checked={draft.requireSocials} onChange={(e) => setDraft((d) => ({ ...d, requireSocials: e.target.checked }))} />
          <span>Must list socials</span>
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className="ag-field" title={f.hint}>
            <span>{f.label}</span>
            <input type="number" inputMode="decimal" value={draft[f.key] ?? ""} placeholder={f.hint} onChange={(e) => setNum(f.key, e.target.value)} />
          </label>
        ))}
      </div>

      <div className="ag-tps">
        <span className="dim">Take profit</span>
        {draft.takeProfits.map((t, i) => (
          <span key={i} className="ag-tp">
            sell
            <input type="number" value={t.sellPct} min={1} max={100} onChange={(e) => setDraft((d) => ({ ...d, takeProfits: d.takeProfits.map((x, j) => (j === i ? { ...x, sellPct: Number(e.target.value) } : x)) }))} />% at
            <input type="number" value={t.atX} min={1.05} step={0.5} onChange={(e) => setDraft((d) => ({ ...d, takeProfits: d.takeProfits.map((x, j) => (j === i ? { ...x, atX: Number(e.target.value) } : x)) }))} />×
            {draft.takeProfits.length > 1 && (
              <button className="ag-tp-x" onClick={() => setDraft((d) => ({ ...d, takeProfits: d.takeProfits.filter((_, j) => j !== i) }))} aria-label="Remove">
                ×
              </button>
            )}
          </span>
        ))}
        {draft.takeProfits.length < 4 && (
          <button className="chip" onClick={() => setDraft((d) => ({ ...d, takeProfits: [...d.takeProfits, { atX: (d.takeProfits.at(-1)?.atX ?? 1) * 2, sellPct: 25 }] }))}>
            + target
          </button>
        )}
      </div>

      <div className="ag-editor-foot">
        <button className="btn primary" onClick={save}>
          Save my style
        </button>
        {note && <span className={`ag-note ${note.tone ?? ""}`}>{note.text}</span>}
      </div>
    </div>
  );
}
