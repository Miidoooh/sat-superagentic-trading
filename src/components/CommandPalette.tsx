"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";
import { setMood } from "./brand/mood";
import { TokenAvatar } from "./TokenAvatar";

export interface PaletteView {
  id: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
}

interface ChainResult {
  address: `0x${string}`;
  symbol: string;
  name: string;
  kind: "stock" | "pons" | "graduated";
  logoUrl?: string;
}

type Item =
  | { type: "token"; key: string; address: string; symbol: string; name: string; logoUrl?: string; meta: string; tone?: "up" | "down"; official: boolean }
  | { type: "view"; key: string; id: string; label: string; icon: React.ReactNode; hint?: string }
  | { type: "action"; key: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };

interface Props {
  tokens: TokenMarket[];
  views: PaletteView[];
  officialToken?: string;
  onOpenToken: (address: string) => void;
  onView: (id: string) => void;
  actions: { label: string; hint?: string; icon: React.ReactNode; run: () => void }[];
}

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

/** ⌘K / Ctrl+K / "/" — jump to any token, view or action from anywhere. */
export default function CommandPalette({ tokens, views, officialToken, onOpenToken, onView, actions }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [chain, setChain] = useState<ChainResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setChain([]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !open && !isTyping(document.activeElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("sat:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sat:palette", onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    setMood("scanning");
  }, [open]);

  // Whole-chain search, debounced.
  useEffect(() => {
    const query = q.trim();
    if (!open || query.length < 2) {
      setChain([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: ChainResult[] }) => setChain(d.results ?? []))
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase().replace(/^\$/, "");
    const official = (a: string) => !!officialToken && a.toLowerCase() === officialToken.toLowerCase();
    const listed = (query ? tokens.filter((t) => t.token.symbol.toLowerCase().includes(query) || t.token.name.toLowerCase().includes(query)) : tokens)
      .slice()
      .sort((a, b) => {
        const exact = Number(b.token.symbol.toLowerCase() === query) - Number(a.token.symbol.toLowerCase() === query);
        return exact || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0);
      })
      .slice(0, query ? 8 : 6);
    const seen = new Set(listed.map((t) => t.token.address.toLowerCase()));
    const tokenItems: Item[] = [
      ...listed.map((t) => ({
        type: "token" as const,
        key: `t:${t.token.address}`,
        address: t.token.address,
        symbol: t.token.symbol,
        name: t.token.name,
        logoUrl: t.token.logoUrl,
        meta: `$${fmtPrice(t.priceUsd)} · ${fmtPct(t.priceChange24hPct)}`,
        tone: t.priceChange24hPct === null ? undefined : t.priceChange24hPct >= 0 ? ("up" as const) : ("down" as const),
        official: official(t.token.address),
      })),
      ...chain
        .filter((r) => !seen.has(r.address.toLowerCase()))
        .slice(0, 8)
        .map((r) => ({
          type: "token" as const,
          key: `c:${r.address}`,
          address: r.address,
          symbol: r.symbol,
          name: r.name,
          logoUrl: r.logoUrl,
          meta: r.kind === "graduated" ? "graduated · v4" : r.kind,
          official: official(r.address),
        })),
    ];
    const match = (s: string) => !query || s.toLowerCase().includes(query);
    const viewItems: Item[] = views.filter((v) => match(v.label)).map((v) => ({ type: "view", key: `v:${v.id}`, ...v }));
    const actionItems: Item[] = actions.filter((a) => match(a.label)).map((a, i) => ({ type: "action", key: `a:${i}`, ...a }));
    return query ? [...tokenItems, ...viewItems, ...actionItems] : [...viewItems, ...tokenItems, ...actionItems];
  }, [q, tokens, chain, views, actions, officialToken]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    if (item.type === "token") onOpenToken(item.address);
    else if (item.type === "view") onView(item.id);
    else item.run();
    close();
  };

  if (!open) return null;

  const sections: { title: string; type: Item["type"] }[] = q.trim()
    ? [
        { title: "Tokens", type: "token" },
        { title: "Go to", type: "view" },
        { title: "Actions", type: "action" },
      ]
    : [
        { title: "Go to", type: "view" },
        { title: "Top tokens", type: "token" },
        { title: "Actions", type: "action" },
      ];

  return (
    <div className="cmdk-backdrop" onMouseDown={close}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24-1.4 1.4-4.24-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" fill="currentColor" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any token, 0x address, view or action…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const exactAddress = /^0x[0-9a-fA-F]{40}$/.test(q.trim());
                if (exactAddress && !items.some((i) => i.type === "token")) {
                  onOpenToken(q.trim());
                  close();
                } else run(items[active]);
              } else if (e.key === "Escape") close();
            }}
          />
          {searching && <span className="cmdk-spin" aria-hidden />}
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {items.length === 0 && !searching && (
            <div className="cmdk-empty">{/^0x[0-9a-fA-F]{40}$/.test(q.trim()) ? "Press Enter to open this address." : "Nothing found. Try a ticker or paste an address."}</div>
          )}
          {sections.map((s) => {
            const group = items.filter((i) => i.type === s.type);
            if (group.length === 0) return null;
            return (
              <div key={s.title} className="cmdk-group">
                <div className="cmdk-title">{s.title}</div>
                {group.map((item) => {
                  const i = items.indexOf(item);
                  return (
                    <button
                      key={item.key}
                      data-index={i}
                      className={`cmdk-item ${i === active ? "active" : ""}`}
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(item)}
                    >
                      {item.type === "token" ? (
                        <>
                          <TokenAvatar src={item.logoUrl} symbol={item.symbol} seed={item.address} size={28} />
                          <span className="cmdk-main">
                            <b>
                              {item.symbol}
                              {item.official && <span className="official">✓</span>}
                            </b>
                            <span className="dim">{item.name}</span>
                          </span>
                          <span className={`cmdk-meta mono ${item.tone ?? "dim"}`}>{item.meta}</span>
                        </>
                      ) : (
                        <>
                          <span className="cmdk-icon">{item.icon}</span>
                          <span className="cmdk-main">
                            <b>{item.label}</b>
                            {item.hint && <span className="dim">{item.hint}</span>}
                          </span>
                          <span className="cmdk-meta dim">{item.type === "view" ? "view" : "action"}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot dim">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⌘</kbd> <kbd>K</kbd> or <kbd>/</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
