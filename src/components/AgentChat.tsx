"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResponse } from "@/lib/agent/agent";
import type { Artifact } from "@/lib/agent/tools";
import Logo from "./Logo";
import ScanTable from "./ScanTable";
import TradeCard, { type ChainInfo } from "./TradeCard";

interface Msg {
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
  tools?: { name: string; ok: boolean }[];
}

const SUGGESTIONS = [
  "Where are whales buying and selling right now?",
  "Which Pons launches are about to graduate?",
  "What are the top smart-money wallets buying today?",
  "Scan for oversold tokens with RSI under 35 and at least $250k of liquidity",
  "Run a deep analysis of NVDA and tell me the key levels",
  "Where is the pool price furthest from the Chainlink oracle right now?",
];

interface Props {
  enabled: boolean;
  chain: ChainInfo | null;
  executionEnabled: boolean;
  onSelectToken: (symbol: string) => void;
}

export default function AgentChat({ enabled, chain, executionEnabled, onSelectToken }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json()) as AgentResponse | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Request failed");
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.reply,
          artifacts: data.artifacts,
          tools: data.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
        },
      ]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `Error: ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="scroll">
        {messages.length === 0 && (
          <>
            <div className="msg">
              <div className="who">
                <Logo size={16} radius={4} />
                SAT
              </div>
              I read Robinhood Chain directly: Uniswap v3 pools for tradeable prices, Chainlink feeds for
              reference prices and history, and event logs for on-chain flow. Ask me to analyse a chart, scan
              the market against your criteria, or draft a trade for you to approve.
            </div>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" disabled={!enabled} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div className={`msg ${m.role}`}>
              <div className="who">{m.role === "user" ? "You" : "SAT"}</div>
              {m.content}
            </div>
            {m.tools && m.tools.length > 0 && (
              <div className="tools">
                {m.tools.map((t, j) => (
                  <span className={`t ${t.ok ? "" : "bad"}`} key={j}>
                    {t.name}
                    {t.ok ? "" : " ✕"}
                  </span>
                ))}
              </div>
            )}
            {m.artifacts?.map((a, j) => {
              if (a.type === "scan") return <ScanTable key={j} result={a.data} onSelect={onSelectToken} />;
              if (a.type === "trade")
                return <TradeCard key={j} proposal={a.data} chain={chain} executionEnabled={executionEnabled} />;
              return null;
            })}
          </div>
        ))}
        {busy && (
          <div className="msg">
            <div className="who">SAT</div>
            <span className="thinking">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          rows={2}
          value={input}
          placeholder="Ask SAT to scan, analyse, or propose a trade…"
          disabled={!enabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button className="btn primary" disabled={!enabled || busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
