import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeChart } from "@/lib/analysis/analyze";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export const maxDuration = 60;

const Query = z.object({
  token: z.string().min(1).max(80),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).default("4h"),
  limit: z.coerce.number().int().min(30).max(500).default(300),
});

export async function GET(req: Request) {
  try {
    const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
    const provider = getProvider();
    const market = await provider.findToken(q.token);
    if (!market) return errorResponse(new Error("Token not found"), 404);
    const timeframes = provider instanceof RobinhoodChainProvider ? provider.timeframesFor(market) : provider.supportedTimeframes;
    if (!timeframes.includes(q.timeframe)) {
      return errorResponse(new Error(`Timeframe ${q.timeframe} unsupported (${timeframes.join(", ")})`), 400);
    }
    const candles = await provider.getCandles(market, q.timeframe, q.limit);
    const analysis = candles.length ? analyzeChart(candles, q.timeframe) : null;
    return NextResponse.json({ source: provider.source, market, candles, analysis });
  } catch (err) {
    if (err instanceof z.ZodError) return errorResponse(new Error("Invalid query"), 400);
    return errorResponse(err);
  }
}
