import { NextResponse } from "next/server";
import { readTrack } from "@/lib/agent/track";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

/** Last-24h paper track record of every preset style. */
export async function GET() {
  try {
    const styles = await Promise.all((["sniper", "momentum", "graduation", "whale"] as const).map((s) => readTrack(s)));
    return NextResponse.json({ styles }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch (err) {
    return errorResponse(err);
  }
}
