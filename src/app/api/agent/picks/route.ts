import { NextResponse } from "next/server";
import { z } from "zod";
import { picksFor } from "@/lib/agent/picks";
import { STYLE_PRESETS, StrategySchema } from "@/lib/agent/strategy";
import { recordPicks } from "@/lib/agent/track";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { exploreUniverse } from "@/lib/radar/explore";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.union([
  z.object({ preset: z.enum(["sniper", "momentum", "graduation", "whale"]), limit: z.number().int().min(1).max(20).optional() }),
  z.object({ strategy: StrategySchema, limit: z.number().int().min(1).max(20).optional() }),
]);

/** Launches that fit a style right now, each with a buy-and-exit plan. Presets also build their public track record. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "agent-picks", 60);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad strategy" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return NextResponse.json({ error: "The agent needs live chain data" }, { status: 501 });
  try {
    const body = parsed.data;
    const strategy = "preset" in body ? STYLE_PRESETS[body.preset] : body.strategy;
    const result = await picksFor(provider, strategy, body.limit ?? 8);
    let track = null;
    if ("preset" in body) {
      const { rows } = await exploreUniverse(provider);
      const marks = new Map(rows.filter((r) => r.mcapUsd).map((r) => [r.token.toLowerCase(), r.mcapUsd as number]));
      track = await recordPicks(body.preset, result.picks, marks).catch(() => null);
    }
    return NextResponse.json({ ...result, strategy, track });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
