import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, rateLimit } from "@/lib/http";
import { prepareTrade } from "@/lib/trade/prepare";
import { TradeIntentSchema } from "@/lib/trade/trade";

export const runtime = "nodejs";

const Body = z.object({
  intent: TradeIntentSchema,
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/**
 * Re-validates guardrails server-side and returns calldata for the user's
 * wallet to sign. Never signs or broadcasts anything itself.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "trade", 30);
  if (limited) return limited;
  try {
    const { intent, wallet } = Body.parse(await req.json());
    const { trade, errors } = await prepareTrade(intent, { wallet: wallet as `0x${string}`, requireExecution: true });
    if (!trade) return NextResponse.json({ error: errors.join(" ") || "Could not build this trade" }, { status: 400 });
    return NextResponse.json(trade);
  } catch (err) {
    if (err instanceof z.ZodError) return errorResponse(new Error("Invalid request body"), 400);
    return errorResponse(err, 400);
  }
}
