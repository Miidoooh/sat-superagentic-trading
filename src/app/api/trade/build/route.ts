import { NextResponse } from "next/server";
import { erc20Abi, getAddress } from "viem";
import { z } from "zod";
import { getPublicClient } from "@/lib/chain/client";
import { executionEnabled, getConfig } from "@/lib/config";
import { getProvider } from "@/lib/data/provider";
import { errorResponse, rateLimit } from "@/lib/http";
import { buildTrade, TradeIntentSchema } from "@/lib/trade/trade";

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
  const limited = rateLimit(req, "trade", 20);
  if (limited) return limited;
  try {
    const { intent, wallet } = Body.parse(await req.json());
    const provider = getProvider();
    if (!provider.capabilities.liveTrading) {
      return errorResponse(new Error(`Trades are disabled for the ${provider.source} data source.`), 400);
    }
    if (!executionEnabled()) {
      return errorResponse(new Error("Execution is disabled: set SAT_ENABLE_TRADING=true to allow trade building."), 400);
    }
    const market = await provider.findToken(intent.token);
    if (!market) return errorResponse(new Error("Token not found"), 404);
    const nativeUsd = await provider.nativeUsd();

    let currentAllowance = 0n;
    if (intent.side === "sell") {
      currentAllowance = await getPublicClient().readContract({
        address: market.token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [getAddress(wallet), getConfig().RH_SWAP_ROUTER!],
      });
    }
    const built = buildTrade(intent, market, nativeUsd, { wallet, currentAllowance });
    return NextResponse.json(built);
  } catch (err) {
    if (err instanceof z.ZodError) return errorResponse(new Error("Invalid request body"), 400);
    return errorResponse(err, 400);
  }
}
