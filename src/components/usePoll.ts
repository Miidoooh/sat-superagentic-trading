"use client";

import { useEffect, useState } from "react";

/**
 * Fetch JSON on an interval. The first load always runs so a view is ready the
 * moment it is seen; refreshes pause while the tab is hidden. Keeps the last
 * good payload on error.
 */
export function usePoll<T>(url: string, intervalMs: number): { data: T | null; error: string; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // Per URL, so changing a filter never waits behind a request for the old one.
    let inFlight = false;
    setLoading(true);
    const load = async (force = false) => {
      if (inFlight || (!force && document.hidden)) return;
      inFlight = true;
      try {
        const r = await fetch(url);
        const d = await r.json();
        if (!r.ok || "error" in d) throw new Error(d.error ?? `Request failed (${r.status})`);
        if (alive) {
          setData(d as T);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (alive) setLoading(false);
      }
    };
    void load(true);
    const timer = setInterval(() => void load(), intervalMs);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs]);

  return { data, error, loading };
}
