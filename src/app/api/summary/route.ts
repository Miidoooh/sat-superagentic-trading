import { NextResponse } from "next/server";
import { getProvider } from "@/lib/data/provider";
import { byDesc } from "@/lib/format";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

/** Lightweight feed for the landing page ticker and stat row. */
export async function GET() {
  try {
    const provider = getProvider();
    const tokens = await provider.listTokens(500);
    const withHistory = tokens.filter((t) => t.hasPriceHistory).length;
    const totalLiquidity = tokens.reduce((sum, t) => sum + t.liquidityUsd, 0);
    const movers = [...tokens]
      .filter((t) => t.venue !== "pons")
      .sort((a, b) => byDesc(a.volume24hUsd ?? 0, b.volume24hUsd ?? 0) || byDesc(a.liquidityUsd, b.liquidityUsd))
      .slice(0, 28)
      .map((t) => ({ symbol: t.token.symbol, priceUsd: t.priceUsd, changePct: t.priceChange24hPct }));

    const ponsTop = tokens
      .filter((t) => t.venue === "pons")
      .sort((a, b) => byDesc(a.liquidityUsd, b.liquidityUsd))
      .slice(0, 24)
      .map((t) => ({
        symbol: t.token.symbol,
        priceUsd: t.priceUsd,
        liquidityUsd: t.liquidityUsd,
        quoteSymbol: t.quoteSymbol,
      }));

    return NextResponse.json(
      {
        source: provider.source,
        tokenCount: tokens.length,
        withHistory,
        totalLiquidityUsd: totalLiquidity,
        tokens: movers,
        pons: ponsTop,
      },
      { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    return errorResponse(err, 503);
  }
}
