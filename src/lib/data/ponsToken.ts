import { getAddress, parseAbiItem } from "viem";
import { PONS_V2_FACTORY } from "../chain/constants";
import { getLogsClient } from "../chain/client";
import { blockClock, blockTime, RollingWindow, spanned, type BlockClock } from "../chain/logs";
import { cache } from "../cache";
import type { Candle, TokenMarket } from "../types";
import { TIMEFRAME_SECONDS, type Timeframe } from "../types";
import { candlesFromPricePoints } from "./candles";
import { curveMarket, findLaunch, quoteOf, readCurveStates, type PonsLaunch, type QuoteBook, type QuoteInfo } from "./pons";
import { readCurveTrades, type RawCurveTrade } from "./ponsFlow";
import { safetyScore, type SafetyScore } from "../safety/score";
import { getTokenMeta } from "./tokenMeta";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Timeframes that make sense for a token that is hours or days old. */
export const PONS_TIMEFRAMES: readonly Timeframe[] = ["5m", "15m", "1h", "4h"];

const HISTORY_TTL = 10 * 1000;
const HOLDERS_TTL = 30 * 1000;
/** A token's whole life fits in one window; the launch block is the floor. */
const LIFETIME_BLOCKS = 9_900_000n;
const LOG_SPAN = 400_000n;
const MAX_TRACKED = 150;
const TOKEN_DECIMALS = 18;
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

export interface PonsTrade {
  id: string;
  time: number;
  side: "buy" | "sell";
  priceUsd: number;
  usd: number;
  tokens: number;
  trader: `0x${string}` | null;
  tx: `0x${string}`;
}

export interface Holder {
  address: `0x${string}`;
  balance: number;
  pct: number;
  label: "curve" | "deployer" | "burn" | null;
}

export interface PonsTokenDetail {
  market: TokenMarket;
  launchedAt: number;
  deployer: `0x${string}`;
  trades: PonsTrade[];
  holders: Holder[];
  holderCount: number;
  stats: { buys: number; sells: number; buyUsd: number; sellUsd: number; traders: number };
  safety: SafetyScore;
}

interface TransferItem {
  block: bigint;
  from: string;
  to: string;
  value: bigint;
}

/** Bounded map: the least recently touched entry goes first. */
class Recent<V> {
  private map = new Map<string, V>();
  get(key: string, make: () => V): V {
    let v = this.map.get(key);
    if (v) this.map.delete(key);
    else v = make();
    this.map.set(key, v);
    if (this.map.size > MAX_TRACKED) this.map.delete(this.map.keys().next().value!);
    return v;
  }
}

const tradeWindows = new Recent<RollingWindow<RawCurveTrade>>();
const transferWindows = new Recent<RollingWindow<TransferItem>>();

async function curveTrades(launch: PonsLaunch): Promise<RawCurveTrade[]> {
  const window = tradeWindows.get(launch.curve.toLowerCase(), () =>
    new RollingWindow(LIFETIME_BLOCKS, spanned(LOG_SPAN, 2, (a, b) => readCurveTrades(a, b, launch.curve)), launch.block),
  );
  return cache.get(`pons:history:${launch.curve.toLowerCase()}`, HISTORY_TTL, async () => window.refresh((await blockClock()).head), {
    swr: true,
  });
}

async function transfers(launch: PonsLaunch): Promise<TransferItem[]> {
  const window = transferWindows.get(launch.token.toLowerCase(), () =>
    new RollingWindow<TransferItem>(
      LIFETIME_BLOCKS,
      spanned(LOG_SPAN, 2, async (a, b) => {
        const logs = await getLogsClient().getLogs({ address: launch.token, event: TRANSFER, fromBlock: a, toBlock: b });
        return logs.flatMap((l) =>
          l.args.from && l.args.to && l.args.value !== undefined
            ? [{ block: l.blockNumber ?? 0n, from: l.args.from.toLowerCase(), to: l.args.to.toLowerCase(), value: l.args.value }]
            : [],
        );
      }),
      launch.block,
    ),
  );
  return cache.get(`pons:transfers:${launch.token.toLowerCase()}`, HOLDERS_TTL, async () => window.refresh((await blockClock()).head), {
    swr: true,
  });
}

/** Execution price and USD size of each trade, oldest first. */
export function priceTrades(raw: RawCurveTrade[], quote: QuoteInfo, clock: BlockClock): PonsTrade[] {
  const out: PonsTrade[] = [];
  for (const t of [...raw].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1))) {
    const quoteAmount = Number(t.quoteGross) / 10 ** quote.decimals;
    const tokens = Number(t.tokens) / 10 ** TOKEN_DECIMALS;
    if (!(quoteAmount > 0) || !(tokens > 0)) continue;
    out.push({
      id: `${t.tx}:${t.logIndex}`,
      time: blockTime(clock, t.block),
      side: t.side,
      priceUsd: (quoteAmount / tokens) * quote.usd,
      usd: quoteAmount * quote.usd,
      tokens,
      trader: t.trader,
      tx: t.tx,
    });
  }
  return out;
}

export function tradeCandles(trades: PonsTrade[], timeframe: Timeframe, limit: number): Candle[] {
  const points = trades.map((t) => ({ time: t.time, price: t.priceUsd, volume: t.usd }));
  return candlesFromPricePoints(points, TIMEFRAME_SECONDS[timeframe], Number.POSITIVE_INFINITY).slice(-limit);
}

/** Replay transfers into balances. Supply is whatever was minted from the zero address. */
export function holdersFrom(items: TransferItem[], labels: Map<string, Holder["label"]>, top = 15): { holders: Holder[]; count: number } {
  const balances = new Map<string, bigint>();
  let supply = 0n;
  for (const t of items) {
    if (t.from === ZERO) supply += t.value;
    else balances.set(t.from, (balances.get(t.from) ?? 0n) - t.value);
    if (t.to === ZERO) supply -= t.value;
    else balances.set(t.to, (balances.get(t.to) ?? 0n) + t.value);
  }
  const positive = [...balances.entries()].filter(([, b]) => b > 0n);
  positive.sort(([, a], [, b]) => (a === b ? 0 : a > b ? -1 : 1));
  const unit = 10 ** TOKEN_DECIMALS;
  return {
    count: positive.length,
    holders: positive.slice(0, top).map(([address, b]) => ({
      address: address as `0x${string}`,
      balance: Number(b) / unit,
      pct: supply > 0n ? Number((b * 1_000_000n) / supply) / 10_000 : 0,
      label: labels.get(address) ?? (address === DEAD ? "burn" : null),
    })),
  };
}

/** Market row for any live Pons curve, listed in the terminal or not. Null once it graduates. */
export async function ponsMarket(token: string, book: QuoteBook): Promise<{ market: TokenMarket; launch: PonsLaunch } | null> {
  const launch = await findLaunch(token);
  if (!launch) return null;
  const [state] = await readCurveStates([launch], book);
  if (!state) return null;
  const meta = (await getTokenMeta([launch.token])).get(launch.token.toLowerCase());
  if (!meta) return null;
  return { market: curveMarket(state, meta), launch };
}

export async function ponsCandles(market: TokenMarket, book: QuoteBook, timeframe: Timeframe, limit: number): Promise<Candle[]> {
  const launch = await findLaunch(market.token.address);
  const quote = launch && quoteOf(launch.pairToken, book);
  if (!launch || !quote) throw new Error(`${market.token.symbol} is not a Pons launch`);
  const [clock, raw] = await Promise.all([blockClock(), curveTrades(launch)]);
  return tradeCandles(priceTrades(raw, quote, clock), timeframe, limit);
}

/** Everything the token panel shows: the latest trades, top holders and flow since launch. */
export async function ponsTokenDetail(token: string, book: QuoteBook): Promise<PonsTokenDetail | null> {
  const found = await ponsMarket(token, book);
  if (!found) return null;
  const { market, launch } = found;
  const quote = quoteOf(launch.pairToken, book);
  if (!quote) return null;
  const [clock, raw, moves] = await Promise.all([blockClock(), curveTrades(launch), transfers(launch).catch(() => [] as TransferItem[])]);
  const trades = priceTrades(raw, quote, clock);

  const labels = new Map<string, Holder["label"]>([
    [launch.curve.toLowerCase(), "curve"],
    [launch.deployer.toLowerCase(), "deployer"],
    [getAddress(PONS_V2_FACTORY).toLowerCase(), "curve"],
  ]);
  const { holders, count } = holdersFrom(moves, labels);

  const wallets = new Set<string>();
  const stats = { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, traders: 0 };
  for (const t of trades) {
    if (t.side === "buy") {
      stats.buys += 1;
      stats.buyUsd += t.usd;
    } else {
      stats.sells += 1;
      stats.sellUsd += t.usd;
    }
    if (t.trader) wallets.add(t.trader.toLowerCase());
  }
  stats.traders = wallets.size;

  const launchedAt = blockTime(clock, launch.block);
  return {
    market,
    launchedAt,
    deployer: launch.deployer,
    trades: trades.slice(-80).reverse(),
    holders,
    holderCount: count,
    stats,
    safety: safetyScore({
      ageSeconds: Math.max(0, clock.headTime - launchedAt),
      holders,
      deployer: launch.deployer,
      trades,
      traders: stats.traders,
      raisedUsd: market.curve?.raisedUsd ?? 0,
    }),
  };
}
