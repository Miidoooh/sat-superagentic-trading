"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
import type { TrenchesSnapshot } from "@/lib/radar/trenches";
import type { RadarSnapshot } from "@/lib/radar/whales";
import { shortAddr, useFollows } from "./follows";

const KEY = "sat:alerts";
const POLL_MS = 15_000;
const MAX_TOASTS = 4;
const TOAST_MS = 9_000;

interface Settings {
  enabled: boolean;
  whaleUsd: number;
  graduationPct: number;
  followed: boolean;
}

const DEFAULTS: Settings = { enabled: false, whaleUsd: 10_000, graduationPct: 90, followed: true };
const WHALE_SIZES = [2_500, 10_000, 25_000, 100_000];
const GRAD_LEVELS = [75, 90, 95];

export interface AlertItem {
  id: string;
  kind: "whale" | "graduation" | "follow" | "launch";
  title: string;
  body: string;
  token?: string;
  wallet?: string;
  url?: string;
}

interface Props {
  onOpenToken: (token: string, url?: string) => void;
  onOpenWallet: (wallet: string) => void;
}

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

/** Turn fresh radar and trenches payloads into alerts, skipping anything already seen. */
export function detectAlerts(
  radar: RadarSnapshot | null,
  trenches: TrenchesSnapshot | null,
  settings: Settings,
  followed: Set<string>,
  seen: Set<string>,
): AlertItem[] {
  const out: AlertItem[] = [];
  const push = (a: AlertItem) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push(a);
  };
  for (const t of radar?.trades ?? []) {
    const byFollowed = settings.followed && t.trader !== null && followed.has(t.trader.toLowerCase());
    if (byFollowed) {
      push({
        id: `follow:${t.id}`,
        kind: "follow",
        title: `${shortAddr(t.trader!)} ${t.side === "buy" ? "bought" : "sold"} ${t.symbol}`,
        body: `${fmtUsd(t.usd, { compact: true })} on ${t.venue === "pons" ? "Pons" : "Uniswap"}`,
        token: t.token,
        wallet: t.trader!,
      });
    } else if (t.usd >= settings.whaleUsd) {
      push({
        id: `whale:${t.id}`,
        kind: "whale",
        title: `Whale ${t.side} · ${t.symbol}`,
        body: `${fmtUsd(t.usd, { compact: true })}${t.trader ? ` by ${shortAddr(t.trader)}` : ""}`,
        token: t.token,
        wallet: t.trader ?? undefined,
      });
    }
  }
  for (const c of trenches?.graduating ?? []) {
    if (c.progressPct < settings.graduationPct) continue;
    push({
      id: `grad:${c.curve}:${settings.graduationPct}`,
      kind: "graduation",
      title: `${c.symbol} is ${c.progressPct.toFixed(0)}% to graduation`,
      body: `${fmtUsd(c.raisedUsd, { compact: true })} of ${fmtUsd(c.thresholdUsd, { compact: true })} raised on its Pons curve`,
      token: c.token,
      url: c.url,
    });
  }
  if (settings.followed) {
    for (const c of trenches?.newest ?? []) {
      if (!followed.has(c.deployer.toLowerCase())) continue;
      push({
        id: `launch:${c.curve}`,
        kind: "launch",
        title: `${shortAddr(c.deployer)} launched ${c.symbol}`,
        body: "New Pons launch from a wallet you follow",
        token: c.token,
        wallet: c.deployer,
        url: c.url,
      });
    }
  }
  return out;
}

export default function AlertsCenter({ onOpenToken, onOpenWallet }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const { follows } = useFollows();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => setSettings(loadSettings()), []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    // New thresholds start from a clean slate so old trades don't all fire at once.
    seen.current = null;
  };

  const enable = async () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    update({ enabled: true });
  };

  const fire = useCallback((items: AlertItem[]) => {
    if (items.length === 0) return;
    setToasts((prev) => [...items.slice(-MAX_TOASTS), ...prev].slice(0, MAX_TOASTS));
    setUnread((n) => n + items.length);
    for (const item of items) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== item.id)), TOAST_MS);
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification(item.title, { body: item.body, tag: item.id, icon: "/logo.png" });
      }
    }
  }, []);

  useEffect(() => {
    if (!settings.enabled) return;
    let alive = true;
    const followed = new Set(follows.map((f) => f.address.toLowerCase()));
    const wallets = follows.map((f) => f.address).join(",");
    const poll = async () => {
      try {
        const [radar, trenches] = await Promise.all([
          fetch(`/api/whales?minUsd=${settings.whaleUsd}&limit=60${wallets ? `&wallets=${wallets}` : ""}`).then((r) =>
            r.ok ? (r.json() as Promise<RadarSnapshot>) : null,
          ),
          fetch("/api/pons").then((r) => (r.ok ? (r.json() as Promise<TrenchesSnapshot>) : null)),
        ]);
        if (!alive) return;
        const first = seen.current === null;
        if (first) seen.current = new Set();
        const items = detectAlerts(radar, trenches, settings, followed, seen.current!);
        // The first poll only records what already happened.
        if (!first) fire(items);
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [settings, follows, fire]);

  const openItem = (a: AlertItem) => {
    if (a.token) onOpenToken(a.token, a.url);
    else if (a.wallet) onOpenWallet(a.wallet);
    setToasts((prev) => prev.filter((t) => t.id !== a.id));
  };

  const denied = typeof Notification !== "undefined" && Notification.permission === "denied";

  return (
    <>
      <div className="alerts">
        <button
          className={`pill alerts-bell ${settings.enabled ? "accent" : ""}`}
          onClick={() => {
            setOpen((o) => !o);
            setUnread(0);
          }}
          title="Alerts"
        >
          🔔 {settings.enabled ? "alerts on" : "alerts"}
          {unread > 0 && <b className="alerts-count">{unread > 99 ? "99+" : unread}</b>}
        </button>
        {open && (
          <div className="alerts-pop">
            <div className="alerts-row">
              <strong>Live alerts</strong>
              <div className="spacer" />
              {settings.enabled ? (
                <button className="btn sm" onClick={() => update({ enabled: false })}>
                  Turn off
                </button>
              ) : (
                <button className="btn sm primary" onClick={enable}>
                  Turn on
                </button>
              )}
            </div>
            <div className="dim alerts-note">
              Checks the chain every 15 seconds while SAT is open in this browser.
              {denied && " Browser notifications are blocked, so alerts show inside the app only."}
            </div>
            <div className="alerts-label">Whale trades at least</div>
            <div className="tfs">
              {WHALE_SIZES.map((s) => (
                <button key={s} className={`tf ${settings.whaleUsd === s ? "active" : ""}`} onClick={() => update({ whaleUsd: s })}>
                  {fmtUsd(s, { compact: true })}
                </button>
              ))}
            </div>
            <div className="alerts-label">Pons curve reaches</div>
            <div className="tfs">
              {GRAD_LEVELS.map((p) => (
                <button key={p} className={`tf ${settings.graduationPct === p ? "active" : ""}`} onClick={() => update({ graduationPct: p })}>
                  {p}%
                </button>
              ))}
            </div>
            <label className="alerts-check">
              <input type="checkbox" checked={settings.followed} onChange={(e) => update({ followed: e.target.checked })} />
              Any trade or launch by a wallet I follow ({follows.length})
            </label>
          </div>
        )}
      </div>
      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <button key={t.id} className={`toast ${t.kind}`} onClick={() => openItem(t)}>
              <strong>{t.title}</strong>
              <span>{t.body}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
