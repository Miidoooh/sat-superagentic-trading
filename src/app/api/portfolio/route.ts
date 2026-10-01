import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { getPortfolio } from "@/lib/portfolio/portfolio";

export const runtime = "nodejs";
export const maxDuration = 60;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const Query = z.object({
  address: z.string().regex(ADDRESS, "address must be a 0x wallet address"),
  tokens: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter((t) => ADDRESS.test(t)).slice(0, 30) : [])),
});

/** Holdings, value and trade PnL for one wallet. Read-only; any address works. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "portfolio", 30);
  if (limited) return limited;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad query" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) {
    return NextResponse.json({ error: "Portfolio needs the live Robinhood Chain provider" }, { status: 501 });
  }
  try {
    const portfolio = await getPortfolio(provider, parsed.data.address, parsed.data.tokens);
    return NextResponse.json(portfolio, { headers: { "cache-control": "private, max-age=20" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
