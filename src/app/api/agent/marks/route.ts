import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { exploreUniverse } from "@/lib/radar/explore";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Every Pons launch has a fixed one-billion supply. */
const SUPPLY = 1_000_000_000;
const MAX_LOOKUPS = 6;

const Query = z.object({
  tokens: z
    .string()
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim().toLowerCase()))].filter((t) => /^0x[0-9a-f]{40}$/.test(t)))
    .pipe(z.array(z.string()).min(1).max(40)),
});

/** Current market cap and price for the tokens a user is tracking against their plan. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "agent-marks", 120);
  if (limited) return limited;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Pass up to 40 token addresses in ?tokens=" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return NextResponse.json({ error: "Live chain data needed" }, { status: 501 });
  try {
    const { rows } = await exploreUniverse(provider);
    const byToken = new Map(rows.map((r) => [r.token.toLowerCase(), r]));
    const marks: Record<string, { mcapUsd: number; priceUsd: number }> = {};
    const missing: string[] = [];
    for (const t of parsed.data.tokens) {
      const r = byToken.get(t);
      if (r?.mcapUsd && r.priceUsd) marks[t] = { mcapUsd: r.mcapUsd, priceUsd: r.priceUsd };
      else missing.push(t);
    }
    // Older graduates fall out of the scan; read those directly.
    await Promise.all(
      missing.slice(0, MAX_LOOKUPS).map(async (t) => {
        const m = await provider.findToken(t).catch(() => null);
        if (m && m.priceUsd > 0) marks[t] = { mcapUsd: m.priceUsd * SUPPLY, priceUsd: m.priceUsd };
      }),
    );
    return NextResponse.json({ marks, at: Date.now() });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
