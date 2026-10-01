"use client";

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 900;

/** "up" or "down" for a moment after a number changes, so live data visibly moves. */
export function useFlash(value: number | null | undefined): "" | "up" | "down" {
  const prev = useRef(value);
  const [dir, setDir] = useState<"" | "up" | "down">("");
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === undefined || before === null || value === undefined || value === null || before === value) return;
    setDir(value > before ? "up" : "down");
    const t = setTimeout(() => setDir(""), FLASH_MS);
    return () => clearTimeout(t);
  }, [value]);
  return dir;
}

/** Wraps a live number; tints and pulses it whenever the value moves. */
export function Flash({ value, className = "", children }: { value: number | null | undefined; className?: string; children: React.ReactNode }) {
  const dir = useFlash(value);
  return <span className={`flash ${dir ? `flash-${dir}` : ""} ${className}`}>{children}</span>;
}
