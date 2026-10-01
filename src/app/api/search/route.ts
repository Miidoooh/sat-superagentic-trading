import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { rankSearch, searchIndex, withLogos, type SearchResult } from "@/lib/search/index";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Find any token: an address resolves directly, text searches the token index. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "search", 90);
  if (limited) return limited;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 64);
  if (q.length < 1) return NextResponse.json({ results: [] });
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return NextResponse.json({ results: [], error: "Search needs live chain data" }, { status: 501 });
  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      const m = await provider.findToken(q);
      const results: SearchResult[] = m
        ? [
            {
              address: m.token.address,
              symbol: m.token.symbol,
              name: m.token.name,
              kind: m.graduated ? "graduated" : m.venue === "pons" ? "pons" : "stock",
              weight: 0,
              logoUrl: m.token.logoUrl,
            },
          ]
        : [];
      return NextResponse.json({ results, partial: false });
    }
    const listed = await provider.listTokens(500);
    const listedLogos = new Map(listed.map((m) => [m.token.address.toLowerCase(), m.token.logoUrl]));
    const { entries, complete } = searchIndex(provider);
    const pool = entries.length
      ? entries
      : listed.map((m) => ({
          address: m.token.address,
          symbol: m.token.symbol,
          name: m.token.name,
          kind: m.venue === "pons" ? ("pons" as const) : ("stock" as const),
          weight: m.volume24hUsd ?? 0,
        }));
    const results = await withLogos(rankSearch(pool, q, 20, getConfig().SAT_TOKEN_ADDRESS), listedLogos);
    return NextResponse.json({ results, indexed: pool.length, complete }, { headers: { "cache-control": "public, s-maxage=20" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
