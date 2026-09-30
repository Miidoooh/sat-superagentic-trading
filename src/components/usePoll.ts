"use client";

import { useEffect, useRef, useState } from "react";

/** Fetch JSON on an interval. Pauses while the tab is hidden and keeps the last good payload on error. */
export function usePoll<T>(url: string, intervalMs: number): { data: T | null; error: string; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const load = async () => {
      if (inFlight.current || document.hidden) return;
      inFlight.current = true;
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
        inFlight.current = false;
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, intervalMs);
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
