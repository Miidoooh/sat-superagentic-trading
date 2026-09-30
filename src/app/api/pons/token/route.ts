import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { ponsTokenDetail } from "@/lib/data/ponsToken";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const Query = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "address must be a 0x token address") });

/** One Pons launch: live curve market, recent trades, top holders and flow since launch. */
export async function GET(req: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad query" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) {
    return NextResponse.json({ error: "Pons token pages need the live Robinhood Chain provider" }, { status: 501 });
  }
  try {
    const detail = await ponsTokenDetail(parsed.data.address, await provider.quoteBook());
    if (!detail) return NextResponse.json({ error: "Not a live Pons curve (it may have graduated)" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "cache-control": "public, s-maxage=8, stale-while-revalidate=30" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
