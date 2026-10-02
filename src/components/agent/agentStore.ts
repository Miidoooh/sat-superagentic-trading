"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { STYLE_PRESETS, StrategySchema, type PickPlan, type Strategy, type Style, type TrackedPosition } from "@/lib/agent/strategy";

const STYLE_KEY = "sat:agent:style";
const POSITIONS_KEY = "sat:agent:positions";
const TELEGRAM_KEY = "sat:agent:telegram";
const EVENT = "sat:agent-changed";
const MAX_POSITIONS = 40;

export type PresetId = Exclude<Style, "custom">;

/** The style the agent runs for this user: a preset, or their own. */
export type ActiveStyle = { kind: "preset"; preset: PresetId } | { kind: "custom"; strategy: Strategy };

const ActiveSchema = z.union([
  z.object({ kind: z.literal("preset"), preset: z.enum(["sniper", "momentum", "graduation", "whale"]) }),
  z.object({ kind: z.literal("custom"), strategy: StrategySchema }),
]);

const PositionSchema = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  symbol: z.string(),
  openedAt: z.number(),
  plan: z.custom<PickPlan>((v) => typeof v === "object" && v !== null && "entryMcap" in v),
  hit: z.array(z.number()),
  peakMcap: z.number(),
  closed: z.boolean().optional(),
});

export type StoredPosition = TrackedPosition & { closed?: boolean };

function read<T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT));
}

function useStored<T>(readNow: () => T, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sync = () => setValue(readNow());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [readNow]);
  return value;
}

const DEFAULT_STYLE: ActiveStyle = { kind: "preset", preset: "momentum" };
const readStyle = () => read<ActiveStyle>(STYLE_KEY, ActiveSchema, DEFAULT_STYLE);
const readPositions = () => read<StoredPosition[]>(POSITIONS_KEY, z.array(PositionSchema) as unknown as z.ZodType<StoredPosition[], z.ZodTypeDef, unknown>, []);

export const strategyOf = (s: ActiveStyle): Strategy => (s.kind === "preset" ? STYLE_PRESETS[s.preset] : s.strategy);

export function useAgentStyle() {
  const style = useStored(readStyle, DEFAULT_STYLE);
  const setStyle = useCallback((next: ActiveStyle) => write(STYLE_KEY, next), []);
  return { style, strategy: strategyOf(style), setStyle };
}

const readTelegram = () => read<boolean>(TELEGRAM_KEY, z.boolean(), true);

/** Whether the agent's new picks go to the linked Telegram chat. */
export function useAgentTelegram() {
  const enabled = useStored(readTelegram, true);
  const setEnabled = useCallback((v: boolean) => write(TELEGRAM_KEY, v), []);
  return { enabled, setEnabled };
}

/** Positions opened from agent picks, tracked against their plans in this browser. */
export function usePositions() {
  const positions = useStored(readPositions, [] as StoredPosition[]);
  const open = useCallback((p: TrackedPosition) => {
    const rest = readPositions().filter((x) => x.token.toLowerCase() !== p.token.toLowerCase() || x.closed);
    write(POSITIONS_KEY, [p, ...rest].slice(0, MAX_POSITIONS));
  }, []);
  const update = useCallback((token: string, patch: Partial<StoredPosition>) => {
    write(
      POSITIONS_KEY,
      readPositions().map((x) => (x.token.toLowerCase() === token.toLowerCase() && !x.closed ? { ...x, ...patch } : x)),
    );
  }, []);
  const remove = useCallback((token: string) => write(POSITIONS_KEY, readPositions().filter((x) => x.token.toLowerCase() !== token.toLowerCase())), []);
  return { positions, open, update, remove };
}
