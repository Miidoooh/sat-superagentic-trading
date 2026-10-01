"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SatHolding, SatMarket } from "@/lib/sat/token";
import { TIERS, type TierInfo, type TierThresholds } from "@/lib/sat/tiers";
import { fmtPrice } from "@/lib/format";
import { Flash } from "./Flash";
import { useCreditReferral } from "./referral";
import { useWallet } from "./wallet";

const REFRESH_MS = 30_000;

interface SatResponse {
  market: SatMarket;
  holding: SatHolding | null;
  thresholds: TierThresholds;
  feeBps: number;
}

interface SatState {
  market: SatMarket | null;
  holding: SatHolding | null;
  thresholds: TierThresholds;
  feeBps: number;
  /** The connected wallet's tier, Free when none is connected. */
  tier: TierInfo;
  loading: boolean;
  refresh: () => void;
}

const Ctx = createContext<SatState | null>(null);

/** SAT price and the connected wallet's tier, shared by every view. */
export function SatProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet();
  useCreditReferral(address);
  const [data, setData] = useState<SatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/sat${address ? `?address=${address}` : ""}`);
        const d = (await r.json()) as SatResponse | { error: string };
        if (alive && r.ok && !("error" in d)) setData(d);
      } catch {
        /* keep the last value */
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const value = useMemo<SatState>(() => {
    const holding = data?.holding && address && data.holding.address.toLowerCase() === address.toLowerCase() ? data.holding : null;
    return {
      market: data?.market ?? null,
      holding,
      thresholds: data?.thresholds ?? { holderUsd: 50, whaleUsd: 500 },
      feeBps: data?.feeBps ?? 0,
      tier: TIERS[holding?.tier ?? "free"],
      loading,
      refresh,
    };
  }, [data, address, loading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSat(): SatState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSat must be used inside <SatProvider>");
  return ctx;
}

/** Top-bar pill: live SAT price, plus the wallet's tier once connected. */
export function SatPill({ onOpen }: { onOpen: () => void }) {
  const { market, tier, holding } = useSat();
  const change = market?.change24hPct ?? null;
  return (
    <button className="pill sat-pill" onClick={onOpen} title="SAT token and holder tiers">
      <span className="sat-pill-sym">SAT</span>
      <Flash value={market?.priceUsd} className="mono">
        {market ? `$${fmtPrice(market.priceUsd)}` : "…"}
      </Flash>
      {change !== null && <span className={`mono ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>}
      {holding && <TierBadge tier={tier} />}
    </button>
  );
}

export function TierBadge({ tier, size = "sm" }: { tier: TierInfo; size?: "sm" | "lg" }) {
  return <span className={`tier-badge ${tier.id} ${size}`}>{tier.id === "whale" ? "🐋 " : tier.id === "holder" ? "◆ " : ""}{tier.name}</span>;
}
