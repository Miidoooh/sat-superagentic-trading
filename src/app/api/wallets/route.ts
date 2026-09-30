import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse } from "@/lib/http";
import { getLeaderboard, getWalletActivity } from "@/lib/radar/wallets";

export const runtime = "nodejs";
export const maxDuration = 60;

const Query = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "address must be a 0x wallet address")
    .optional(),
});

/** Top-trader leaderboard, or one wallet's last 24 hours with `?address=`. */
export async function GET(req: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad query" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) {
    return NextResponse.json({ error: "Wallet tracking needs the live Robinhood Chain provider" }, { status: 501 });
  }
  try {
    const body = parsed.data.address
      ? await getWalletActivity(provider, parsed.data.address)
      : await getLeaderboard(provider);
    return NextResponse.json(body, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
