"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "sat:follows";
const EVENT = "sat:follows-changed";
const MAX_FOLLOWS = 50;

export interface Follow {
  address: `0x${string}`;
  label?: string;
}

function read(): Follow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((f): f is Follow => typeof f?.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(f.address));
  } catch {
    return [];
  }
}

function write(list: Follow[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_FOLLOWS)));
  window.dispatchEvent(new Event(EVENT));
}

/** Followed wallets, kept in this browser only and shared across every view. */
export function useFollows() {
  const [follows, setFollows] = useState<Follow[]>([]);

  useEffect(() => {
    const sync = () => setFollows(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const isFollowed = useCallback(
    (address: string) => follows.some((f) => f.address.toLowerCase() === address.toLowerCase()),
    [follows],
  );

  const toggle = useCallback((address: `0x${string}`) => {
    const list = read();
    const i = list.findIndex((f) => f.address.toLowerCase() === address.toLowerCase());
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ address });
    write(list);
  }, []);

  return { follows, isFollowed, toggle };
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
