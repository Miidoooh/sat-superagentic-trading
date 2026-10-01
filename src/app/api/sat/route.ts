import { NextResponse } from "next/server";
import { getConfig, tradeFeeBps } from "@/lib/config";
import { errorResponse, rateLimit } from "@/lib/http";
import { getSatMarket, satHolding, thresholds } from "@/lib/sat/token";
import { TIERS } from "@/lib/sat/tiers";

export const runtime = "nodejs";
export const maxDuration = 30;

/** SAT token market, tiers, and (with ?address=) one wallet's holding and tier. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "sat", 120);
  if (limited) return limited;
  const address = new URL(req.url).searchParams.get("address");
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "Bad address" }, { status: 400 });
  try {
    const cfg = getConfig();
    const [market, holding] = await Promise.all([getSatMarket(), address ? satHolding(address as `0x${string}`) : Promise.resolve(null)]);
    return NextResponse.json(
      { market, holding, tiers: TIERS, thresholds: thresholds(cfg), feeBps: tradeFeeBps(cfg) },
      { headers: { "cache-control": address ? "private, max-age=10" : "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (err) {
    return errorResponse(err, 503);
  }
}
