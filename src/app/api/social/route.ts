import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { getSocial } from "@/lib/social/radar";

export const runtime = "nodejs";
export const maxDuration = 60;

const Query = z.object({
  token: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  minFollowers: z.coerce.number().int().min(0).max(1e9).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Who on X is talking about Robinhood Chain tokens, newest first. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "social", 120);
  if (limited) return limited;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bad query" }, { status: 400 });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return NextResponse.json({ error: "Live chain data needed" }, { status: 501 });
  try {
    const { token, minFollowers, limit } = parsed.data;
    const snap = await getSocial(provider);
    const posts = snap.posts
      .filter((p) => p.author.followers >= minFollowers)
      .filter((p) => !token || p.tokens.some((t) => t.token.toLowerCase() === token.toLowerCase()))
      .slice(0, limit);
    const tokens = token ? snap.tokens.filter((t) => t.token.toLowerCase() === token.toLowerCase()) : snap.tokens.slice(0, 20);
    return NextResponse.json({ ...snap, posts, tokens }, { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=60" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
