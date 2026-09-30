import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse } from "@/lib/http";
import { getWhaleRadar } from "@/lib/radar/whales";

export const runtime = "nodejs";
export const maxDuration = 60;

const QuerySchema = z.object({
  minUsd: z.coerce.number().min(0).max(10_000_000).default(1000),
  venue: z.enum(["all", "stock", "pons"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(120),
});

/** Large buys and sells plus net flow across Stock Token pools and Pons curves. */
export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad query" }, { status: 400 });

  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) {
    return NextResponse.json({ error: "Whale Radar needs the live Robinhood Chain provider" }, { status: 501 });
  }
  try {
    const radar = await getWhaleRadar(provider, parsed.data);
    return NextResponse.json(radar, {
      headers: { "cache-control": "public, s-maxage=8, stale-while-revalidate=30" },
    });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
