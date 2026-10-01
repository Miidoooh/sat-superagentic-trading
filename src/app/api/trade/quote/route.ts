import { NextResponse } from "next/server";
import { z } from "zod";
import { executionEnabled } from "@/lib/config";
import { errorResponse, rateLimit } from "@/lib/http";
import { prepareTrade } from "@/lib/trade/prepare";
import { TradeIntentSchema } from "@/lib/trade/trade";

export const runtime = "nodejs";

const Body = z.object({
  intent: TradeIntentSchema,
  wallet: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullish(),
});

/** Live quote for the trade panel. Read-only: returns no calldata. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "quote", 90);
  if (limited) return limited;
  try {
    const { intent, wallet } = Body.parse(await req.json());
    const { trade, errors } = await prepareTrade(intent, { wallet: (wallet ?? null) as `0x${string}` | null, requireExecution: false });
    return NextResponse.json({
      ok: trade !== null,
      errors,
      executionEnabled: executionEnabled(),
      quote: trade && {
        venue: trade.venue,
        amountIn: trade.amountIn,
        estimatedOut: trade.estimatedOut,
        minOut: trade.minOut,
        slippageBps: trade.slippageBps,
        notionalUsd: trade.notionalUsd,
        priceImpactPct: trade.priceImpactPct ?? null,
        exact: trade.exact ?? false,
        needsApproval: trade.needsRebuild === true || trade.steps.some((s) => s.label.startsWith("Approve")),
        warnings: trade.warnings,
        feeBps: trade.feeBps ?? 0,
        feeUsd: trade.feeUsd ?? 0,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return errorResponse(new Error("Invalid request body"), 400);
    return errorResponse(err, 400);
  }
}
