"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ALERT_SETTINGS, detectAlerts, type AlertItem, type AlertSettings } from "@/lib/alerts/detect";
import { evaluateRules, newRuleState, planPoll } from "@/lib/alerts/rules";
import { fmtUsd } from "@/lib/format";
import type { TrenchesSnapshot } from "@/lib/radar/trenches";
import type { RadarSnapshot } from "@/lib/radar/whales";
import type { TokenMarket } from "@/lib/types";
import type { TierId } from "@/lib/sat/tiers";
import { useAgentStyle, useAgentTelegram } from "./agent/agentStore";
import { useRules, useTelegramLink } from "./alertStore";
import { setMood } from "./brand/mood";
import Satellite from "./brand/Satellite";
import { useSat } from "./sat";
import { useFollows } from "./follows";
import RulesPanel from "./RulesPanel";
import TelegramPanel from "./TelegramPanel";

export { detectAlerts, type AlertItem };

const KEY = "sat:alerts";
const POLL_MS = 15_000;
const SYNC_DEBOUNCE_MS = 800;
const MAX_TOASTS = 4;
const TOAST_MS = 9_000;

const WHALE_SIZES = [2_500, 10_000, 25_000, 100_000];
const GRAD_LEVELS = [75, 90, 95];

interface Props {
  onOpenToken: (token: string, url?: string) => void;
  onOpenWallet: (wallet: string) => void;
  onOpenSat: () => void;
  agentEnabled: boolean;
}

function loadSettings(): AlertSettings {
  try {
    return { ...DEFAULT_ALERT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AlertSettings>) };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

const getJson = <T,>(url: string): Promise<T | null> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);

export default function AlertsCenter({ onOpenToken, onOpenWallet, onOpenSat, agentEnabled }: Props) {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const { follows } = useFollows();
  const { rules: allRules } = useRules();
  const { link, save: saveLink, update: updateLink } = useTelegramLink();
  const { tier } = useSat();
  const rules = useMemo(() => allRules.slice(0, tier.maxRules), [allRules, tier.maxRules]);
  const linkToken = link?.token ?? null;
  const proof = link?.proof;
  const { strategy } = useAgentStyle();
  const { enabled: agentTelegram } = useAgentTelegram();

  useEffect(() => setSettings(loadSettings()), []);

  const update = (patch: Partial<AlertSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const enable = async () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    update({ enabled: true });
  };

  // Mirror settings, follows and rules to the linked Telegram chat.
  useEffect(() => {
    if (!linkToken) return;
    const timer = setTimeout(async () => {
      const res = await fetch("/api/telegram/sync", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: linkToken, settings, follows: follows.map((f) => f.address), rules: allRules, agent: { enabled: agentTelegram, strategy }, proof }),
      }).catch(() => null);
      if (res?.status === 404) return saveLink(null);
      const json = res ? ((await res.json().catch(() => null)) as { wallet?: string | null; tier?: TierId; error?: string } | null) : null;
      if (res?.ok && json) updateLink({ wallet: json.wallet ?? undefined, tier: json.tier, proof: undefined });
      else if (proof && json?.error) updateLink({ proof: undefined });
    }, SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [linkToken, proof, settings, follows, allRules, agentTelegram, strategy, saveLink, updateLink]);

  const fire = useCallback(
    (items: AlertItem[]) => {
      if (items.length === 0) return;
      setMood(items.some((i) => i.kind === "whale" || i.kind === "follow") ? "whale" : "pump");
      setToasts((prev) => [...items.slice(-MAX_TOASTS), ...prev].slice(0, MAX_TOASTS));
      setUnread((n) => n + items.length);
      for (const item of items) {
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== item.id)), TOAST_MS);
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
          new Notification(item.title, { body: item.body, tag: item.id, icon: "/logo.png" });
        }
      }
      if (linkToken) {
        void fetch("/api/telegram/notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: linkToken, alerts: items.slice(0, 20) }),
        }).catch(() => undefined);
      }
    },
    [linkToken],
  );

  useEffect(() => {
    if (!settings.enabled) return;
    let alive = true;
    // Restarting (new thresholds, follows or rules) begins from a clean slate so old trades don't all fire at once.
    let first = true;
    const seen = new Set<string>();
    const ruleState = newRuleState();
    const followed = new Set(follows.map((f) => f.address.toLowerCase()));
    const plan = planPoll(settings, [...followed], rules);
    const wallets = plan.wallets.slice(0, 50).join(",");

    const poll = async () => {
      const [radar, trenches, market] = await Promise.all([
        getJson<RadarSnapshot>(`/api/whales?minUsd=${plan.minUsd}&limit=200${wallets ? `&wallets=${wallets}` : ""}`),
        getJson<TrenchesSnapshot>("/api/pons"),
        plan.markets ? getJson<{ tokens: TokenMarket[] }>("/api/market") : Promise.resolve(null),
      ]);
      if (!alive) return;
      const builtIn = detectAlerts(radar, trenches, settings, followed, seen);
      const fromRules = evaluateRules(rules, { radar, trenches, markets: market?.tokens ?? null }, ruleState);
      // The first poll only records what already happened, except price levels that are already met.
      fire(first ? fromRules.filter((a) => a.id.includes(":price:")) : [...builtIn, ...fromRules]);
      first = false;
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [settings, follows, rules, fire]);

  const openItem = (a: AlertItem) => {
    if (a.token) onOpenToken(a.token, a.url);
    else if (a.wallet) onOpenWallet(a.wallet);
    setToasts((prev) => prev.filter((t) => t.id !== a.id));
  };

  const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
  const activeRules = rules.filter((r) => r.enabled).length;

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
          <>
            <div className="drawer-backdrop" onClick={() => setOpen(false)} />
            <aside className="alerts-drawer" role="dialog" aria-label="Alerts">
              <div className="alerts-row">
                <strong>Alerts &amp; autopilot</strong>
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
                <button className="drawer-close" onClick={() => setOpen(false)} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="dim alerts-note">
                Checks the chain every 15 seconds while SAT is open
                {activeRules > 0 ? `, including ${activeRules} rule${activeRules === 1 ? "" : "s"}` : ""}.
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
              <RulesPanel
                agentEnabled={agentEnabled}
                onUpgrade={() => {
                  setOpen(false);
                  onOpenSat();
                }}
              />
              <TelegramPanel />
            </aside>
          </>
        )}
      </div>
      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <button key={t.id} className={`toast ${t.kind}`} onClick={() => openItem(t)}>
              <span className="toast-bot">
                <Satellite mood={t.kind === "whale" || t.kind === "follow" ? "whale" : "pump"} size={40} orbit={false} />
              </span>
              <strong>{t.title}</strong>
              <span>{t.body}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
