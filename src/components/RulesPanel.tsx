"use client";

import { useState } from "react";
import { describeRule, type Rule } from "@/lib/alerts/rules";
import { useRules } from "./alertStore";

const EXAMPLES = [
  "Tell me when whales buy more than $25k of NVDA",
  "Any Pons curve hits 95% while net buying is over $5k",
  "Alert me if TSLA drops below $300",
];

/** Plain-words alert rules. They only notify; nothing here can trade. */
export default function RulesPanel({ agentEnabled }: { agentEnabled: boolean }) {
  const { rules, add, remove, toggle } = useRules();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value = text) => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rules/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = (await res.json()) as { rules?: Rule[]; error?: string };
      if (!res.ok || !json.rules) throw new Error(json.error ?? "Could not create that rule");
      add(json.rules);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rules">
      <div className="alerts-label">My rules</div>
      {agentEnabled ? (
        <form
          className="rules-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            className="rules-input"
            value={text}
            maxLength={300}
            placeholder="Describe an alert in your own words…"
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <button className="btn sm primary" type="submit" disabled={busy || text.trim().length < 3}>
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
      ) : (
        <div className="dim alerts-note">Plain-words rules need the SAT agent, which is off on this deployment.</div>
      )}
      {error && <div className="rules-error">{error}</div>}
      {agentEnabled && rules.length === 0 && (
        <div className="rules-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => void submit(ex)} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>
      )}
      {rules.length > 0 && (
        <ul className="rules-list">
          {rules.map((r) => (
            <li key={r.id} className={`rule ${r.enabled ? "" : "is-off"}`}>
              <label className="rule-toggle" title={r.enabled ? "Pause" : "Resume"}>
                <input type="checkbox" checked={r.enabled} onChange={() => toggle(r.id)} />
              </label>
              <div className="rule-body">
                <strong>{describeRule(r)}</strong>
                {r.text && <span className="dim">“{r.text}”</span>}
              </div>
              <button className="rule-remove" onClick={() => remove(r.id)} title="Delete rule" aria-label="Delete rule">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dim alerts-note">Rules only send alerts. SAT never trades for you.</div>
    </div>
  );
}
