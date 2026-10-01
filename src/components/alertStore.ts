"use client";

import { useCallback, useEffect, useState } from "react";
import { RuleListSchema, type Rule } from "@/lib/alerts/rules";

const RULES_KEY = "sat:rules";
const RULES_EVENT = "sat:rules-changed";
const TG_KEY = "sat:telegram";
const TG_EVENT = "sat:telegram-changed";

function readRules(): Rule[] {
  try {
    const parsed = RuleListSchema.safeParse(JSON.parse(localStorage.getItem(RULES_KEY) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeRules(rules: Rule[]) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules.slice(0, 30)));
  window.dispatchEvent(new Event(RULES_EVENT));
}

function useStored<T>(read: () => T, event: string, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sync = () => setValue(read());
    sync();
    window.addEventListener(event, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(event, sync);
      window.removeEventListener("storage", sync);
    };
  }, [read, event]);
  return value;
}

/** Autopilot rules, kept in this browser (and mirrored to Telegram when linked). */
export function useRules() {
  const rules = useStored(readRules, RULES_EVENT, [] as Rule[]);
  const add = useCallback((added: Rule[]) => writeRules([...added, ...readRules()]), []);
  const remove = useCallback((id: string) => writeRules(readRules().filter((r) => r.id !== id)), []);
  const toggle = useCallback(
    (id: string) => writeRules(readRules().map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))),
    [],
  );
  return { rules, add, remove, toggle };
}

export interface TelegramLink {
  token: string;
  linkedAt: number;
}

function readTelegram(): TelegramLink | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TG_KEY) ?? "null") as TelegramLink | null;
    return raw && /^[0-9a-f]{48}$/.test(raw.token) ? raw : null;
  } catch {
    return null;
  }
}

export function useTelegramLink() {
  const link = useStored(readTelegram, TG_EVENT, null as TelegramLink | null);
  const save = useCallback((token: string | null) => {
    if (token) localStorage.setItem(TG_KEY, JSON.stringify({ token, linkedAt: Date.now() } satisfies TelegramLink));
    else localStorage.removeItem(TG_KEY);
    window.dispatchEvent(new Event(TG_EVENT));
  }, []);
  return { link, save };
}
