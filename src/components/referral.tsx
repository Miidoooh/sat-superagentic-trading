"use client";

import { useEffect, useState } from "react";

const KEY = "sat:ref";
const SENT_KEY = "sat:ref-sent";
const isAddress = (s: string | null): s is string => !!s && /^0x[0-9a-fA-F]{40}$/.test(s);

/** Remember the first referral link this browser arrived through. */
export function RefCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (isAddress(ref) && !localStorage.getItem(KEY)) localStorage.setItem(KEY, ref.toLowerCase());
  }, []);
  return null;
}

/** Credit the referrer once a wallet connects. */
export function useCreditReferral(wallet: string | null) {
  useEffect(() => {
    const ref = localStorage.getItem(KEY);
    if (!wallet || !isAddress(ref) || localStorage.getItem(SENT_KEY) === wallet.toLowerCase()) return;
    localStorage.setItem(SENT_KEY, wallet.toLowerCase());
    void fetch("/api/ref", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref, wallet }),
    }).catch(() => undefined);
  }, [wallet]);
}

export function useReferralCount(wallet: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!wallet) return setCount(null);
    fetch(`/api/ref?address=${wallet}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number }>) : null))
      .then((d) => setCount(d?.count ?? null))
      .catch(() => setCount(null));
  }, [wallet]);
  return count;
}

export function referralLink(wallet: string, path = "/"): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://sathood.xyz";
  return `${origin}${path}${path.includes("?") ? "&" : "?"}ref=${wallet}`;
}
