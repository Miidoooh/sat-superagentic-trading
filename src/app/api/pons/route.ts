import { NextResponse } from "next/server";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse } from "@/lib/http";
import { getTrenches, TRENCHES_FRESH_MS, TRENCHES_KEY } from "@/lib/radar/trenches";
import { sharedSnapshot } from "@/lib/store/snapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pons launchpad trenches: new launches, near-graduation curves, hot curves, recent graduations. */
export async function GET() {
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) {
    return NextResponse.json({ error: "Pons Trenches needs the live Robinhood Chain provider" }, { status: 501 });
  }
  try {
    const trenches = await sharedSnapshot(TRENCHES_KEY, TRENCHES_FRESH_MS, () => getTrenches(provider));
    return NextResponse.json(trenches, {
      headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
