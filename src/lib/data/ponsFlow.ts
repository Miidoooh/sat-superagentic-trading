import { parseAbiItem, type Log } from "viem";
import { KNOWN_ROUTERS } from "../chain/constants";
import { getLogsClient } from "../chain/client";
import { blockClock, blocksFor, RollingWindow, spanned } from "../chain/logs";
import { cache } from "../cache";

export const CURVE_BUY = parseAbiItem(
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
);
export const CURVE_SELL = parseAbiItem(
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
);

export const FLOW_WINDOW_SECONDS = 30 * 60;
const TRADES_TTL = 8 * 1000;
const DAY_TTL = 30 * 1000;
/**
 * A busy 24h holds ~350k curve trades and 20k blocks already returns ~9k of
 * the node's 10k-log cap. Without an address filter the node also refuses
 * ranges over 30k blocks.
 */
const DAY_SPAN = 12_000n;

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

type CurveLog = Log<bigint, number, false, undefined, true, readonly [typeof CURVE_BUY, typeof CURVE_SELL]>;

function decode(logs: readonly CurveLog[]): RawCurveTrade[] {
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

/** Curve trades in a block range, optionally from one curve only. */
export async function readCurveTrades(from: bigint, to: bigint, curve?: `0x${string}`): Promise<RawCurveTrade[]> {
  const logs = await getLogsClient().getLogs({
    address: curve,
    events: [CURVE_BUY, CURVE_SELL],
    fromBlock: from,
    toBlock: to,
  });
  return decode(logs as unknown as CurveLog[]);
}

/** Curve trades that paid out to one wallet, on any curve. */
export async function readWalletCurveTrades(from: bigint, to: bigint, wallet: `0x${string}`): Promise<RawCurveTrade[]> {
  const client = getLogsClient();
  const [buys, sells] = await Promise.all([
    client.getLogs({ event: CURVE_BUY, args: { recipient: wallet }, fromBlock: from, toBlock: to }),
    client.getLogs({ event: CURVE_SELL, args: { recipient: wallet }, fromBlock: from, toBlock: to }),
  ]);
  return decode([...buys, ...sells] as unknown as CurveLog[]);
}

const recentWindow = new RollingWindow<RawCurveTrade>(blocksFor(FLOW_WINDOW_SECONDS), (a, b) => readCurveTrades(a, b));

/**
 * Every bonding-curve trade in the last 30 minutes. Other Pons V2 forks emit
 * the same events, so callers must keep only curves the Pons factory launched.
 */
export async function recentCurveTrades(): Promise<RawCurveTrade[]> {
  return cache.get("pons:trades", TRADES_TTL, async () => recentWindow.refresh((await blockClock()).head), { swr: true });
}

const dayWindow = new RollingWindow<RawCurveTrade>(blocksFor(86_400), spanned(DAY_SPAN, 3, (a, b) => readCurveTrades(a, b)));

/** Every curve trade in the last 24 hours. The first fill is slow; refreshes read only new blocks. */
export async function dayCurveTrades(): Promise<RawCurveTrade[]> {
  return cache.get("pons:trades:24h", DAY_TTL, async () => dayWindow.refresh((await blockClock()).head), { swr: true });
}
