import { NextResponse } from "next/server";
import { getProvider } from "@/lib/data/provider";
import { RobinhoodChainProvider } from "@/lib/data/robinhood";
import { errorResponse, rateLimit } from "@/lib/http";
import { getFlowReport } from "@/lib/report/flow";

export const runtime = "nodejs";
export const maxDuration = 120;

/** The last 24 hours of Robinhood Chain flow, as data. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "report", 60);
  if (limited) return limited;
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) return NextResponse.json({ error: "The report needs live chain data" }, { status: 501 });
  try {
    const report = await getFlowReport(provider);
    return NextResponse.json(report, { headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" } });
  } catch (err) {
    return errorResponse(err, 503);
  }
}
