import { NextResponse } from "next/server";
import { executionEnabled, getConfig } from "@/lib/config";
import { getProvider } from "@/lib/data/provider";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  try {
    const cfg = getConfig();
    const provider = getProvider();
    // listTokens already returns deepest-liquidity first.
    const tokens = await provider.listTokens(500);
    return NextResponse.json({
      source: provider.source,
      timeframes: provider.supportedTimeframes,
      capabilities: provider.capabilities,
      chain: {
        id: cfg.RH_CHAIN_ID,
        name: cfg.RH_CHAIN_NAME,
        rpcUrl: cfg.RH_RPC_URL,
        explorer: cfg.RH_EXPLORER_URL,
        symbol: cfg.RH_NATIVE_SYMBOL,
      },
      execution: {
        enabled: executionEnabled(cfg) && provider.capabilities.liveTrading,
        maxTradeNative: cfg.SAT_MAX_TRADE_NATIVE,
        maxSlippageBps: cfg.SAT_MAX_SLIPPAGE_BPS,
      },
      agentEnabled: Boolean(cfg.OPENAI_API_KEY),
      tokens,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
