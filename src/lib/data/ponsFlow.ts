import { parseAbiItem } from "viem";
import { KNOWN_ROUTERS } from "../chain/constants";
import { getPublicClient } from "../chain/client";
import { blockClock, blocksFor, RollingWindow } from "../chain/logs";
import { cache } from "../cache";

const CURVE_BUY = parseAbiItem(
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
);
const CURVE_SELL = parseAbiItem(
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
);

export const FLOW_WINDOW_SECONDS = 30 * 60;
const TRADES_TTL = 8 * 1000;

/** One bonding-curve trade, unpriced. Emitted by the curve contract itself. */
export interface RawCurveTrade {
  block: bigint;
  curve: `0x${string}`;
  side: "buy" | "sell";
  /** Quote notional: quoteIn on a buy, quoteOut + fee + tax on a sell (same basis as DefiLlama). */
  quoteGross: bigint;
  tokens: bigint;
  trader: `0x${string}` | null;
  tx: `0x${string}`;
  logIndex: number;
}

/** The wallet that ends up with the output, unless that is a router contract. */
export function pickTrader(
  ...candidates: (`0x${string}` | undefined)[]
): `0x${string}` | null {
  for (const c of candidates) if (c && !KNOWN_ROUTERS.has(c.toLowerCase())) return c;
  return null;
}

async function readCurveTrades(from: bigint, to: bigint): Promise<RawCurveTrade[]> {
  const logs = await getPublicClient().getLogs({ events: [CURVE_BUY, CURVE_SELL], fromBlock: from, toBlock: to });
  const out: RawCurveTrade[] = [];
  for (const log of logs) {
    if (!log.transactionHash || log.logIndex === null) continue;
    const base = { block: log.blockNumber ?? 0n, curve: log.address, tx: log.transactionHash, logIndex: log.logIndex };
    if (log.eventName === "CurveBuy") {
      const { buyer, recipient, quoteIn, tokensOut } = log.args;
      if (quoteIn === undefined || tokensOut === undefined) continue;
      out.push({ ...base, side: "buy", quoteGross: quoteIn, tokens: tokensOut, trader: pickTrader(recipient, buyer) });
    } else if (log.eventName === "CurveSell") {
      const { seller, recipient, tokensIn, quoteOut, fee, tax } = log.args;
      if (tokensIn === undefined || quoteOut === undefined) continue;
      out.push({
        ...base,
        side: "sell",
        quoteGross: quoteOut + (fee ?? 0n) + (tax ?? 0n),
        tokens: tokensIn,
        trader: pickTrader(recipient, seller),
      });
    }
  }
  return out;
}

const window = new RollingWindow<RawCurveTrade>(blocksFor(FLOW_WINDOW_SECONDS), readCurveTrades);

/**
 * Every bonding-curve trade in the last 30 minutes. Other Pons V2 forks emit
 * the same events, so callers must keep only curves the Pons factory launched.
 */
export async function recentCurveTrades(): Promise<RawCurveTrade[]> {
  return cache.get("pons:trades", TRADES_TTL, async () => window.refresh((await blockClock()).head), { swr: true });
}
