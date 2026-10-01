import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { explore } from "@/lib/radar/explore";

export const runtime = "nodejs";
export const maxDuration = 60;

const Query = z.object({
  tab: z.enum(["new", "trending", "almost", "graduated"]).default("new"),
  sort: z.enum(["age", "mcap", "volume", "progress", "txns", "net"]).optional(),
  q: z.string().max(64).optional(),
  minMcap: z.coerce.number().min(0).max(1e12).optional(),
  minVol: z.coerce.number().min(0).max(1e12).optional(),
  socials: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(300).default(50),
});

/** GMGN-style Pons table: tabs, filters, sorting and paging over every scanned curve. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "explore", 120);
  if (limited) return limited;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad query" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return NextResponse.json({ error: "Explore needs live chain data" }, { status: 501 });
  try {
    const page = await explore(provider, parsed.data);
    return NextResponse.json(page, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=20" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
