"use client";

import { useEffect, useState } from "react";
import type { SatMood } from "./Satellite";

const EVENT = "sat:mood";
const HOLD_MS: Record<SatMood, number> = { watching: 0, whale: 5_000, pump: 4_000, scanning: 2_500 };

/** Anywhere in the app can make SAT react: a whale alert, a confirmed trade, a search. */
export function setMood(mood: SatMood) {
  window.dispatchEvent(new CustomEvent<SatMood>(EVENT, { detail: mood }));
}

/** SAT's current mood; reactions fade back to watching on their own. */
export function useMood(): SatMood {
  const [mood, setState] = useState<SatMood>("watching");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const next = (e as CustomEvent<SatMood>).detail;
      setState(next);
      clearTimeout(timer);
      if (HOLD_MS[next]) timer = setTimeout(() => setState("watching"), HOLD_MS[next]);
    };
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener(EVENT, on);
      clearTimeout(timer);
    };
  }, []);
  return mood;
}
