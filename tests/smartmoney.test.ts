import { describe, expect, it, vi } from "vitest";
import { detectAlerts } from "@/components/AlertsCenter";
import { RollingWindow } from "@/lib/chain/logs";
import { candlesFromPricePoints } from "@/lib/data/candles";
import { holdersFrom, priceTrades, tradeCandles } from "@/lib/data/ponsToken";
import type { RawCurveTrade } from "@/lib/data/ponsFlow";
import type { TrenchesSnapshot } from "@/lib/radar/trenches";
import { rankTraders } from "@/lib/radar/wallets";
import type { PricedTrade, RadarSnapshot } from "@/lib/radar/whales";

const A = "0x00000000000000000000000000000000000000aa" as const;
const B = "0x00000000000000000000000000000000000000bb" as const;
const TOKEN = "0x00000000000000000000000000000000000000a1" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const E18 = 10n ** 18n;

describe("RollingWindow floor", () => {
  it("never reads before the floor block, even with a huge window", async () => {
    const fetchRange = vi.fn(async (_from: bigint, to: bigint) => [{ block: to }]);
    const w = new RollingWindow(1_000_000n, fetchRange, 500n);
    const items = await w.refresh(900n);
    expect(fetchRange).toHaveBeenCalledWith(499n, 900n);
    expect(items).toEqual([{ block: 900n }]);
  });
});

describe("curve candles", () => {
  it("sums trade volume per bucket and carries flat candles across any gap", () => {
    const candles = candlesFromPricePoints(
      [
        { time: 0, price: 1, volume: 10 },
        { time: 30, price: 2, volume: 5 },
        { time: 600, price: 3, volume: 1 },
      ],
      60,
      Number.POSITIVE_INFINITY,
    );
    expect(candles).toHaveLength(11);
    expect(candles[0]).toMatchObject({ open: 1, high: 2, close: 2, volume: 15 });
    expect(candles[5]).toMatchObject({ open: 2, close: 2, volume: 0 });
    expect(candles[10]).toMatchObject({ open: 2, close: 3, volume: 1 });
  });

  it("prices each trade from its own quote and token amounts", () => {
    const clock = { head: 1000n, headTime: 10_000 };
    const raw: RawCurveTrade[] = [
      { block: 990n, curve: A, side: "buy", quoteGross: E18, tokens: 1_000_000n * E18, trader: B, tx: `0x${"1".repeat(64)}`, logIndex: 0 },
      { block: 999n, curve: A, side: "sell", quoteGross: E18 / 2n, tokens: 400_000n * E18, trader: null, tx: `0x${"2".repeat(64)}`, logIndex: 1 },
    ];
    const trades = priceTrades(raw, { usd: 2_000, decimals: 18, symbol: "ETH" }, clock);
    expect(trades[0].priceUsd).toBeCloseTo(0.002);
    expect(trades[0].usd).toBeCloseTo(2_000);
    expect(trades[1].priceUsd).toBeCloseTo(0.0025);
    expect(trades[0].time).toBeLessThan(trades[1].time);
    expect(tradeCandles(trades, "5m", 10).at(-1)?.close).toBeCloseTo(0.0025);
  });
});

describe("holders", () => {
  it("replays transfers into balances and supply shares", () => {
    const { holders, count } = holdersFrom(
      [
        { block: 1n, from: ZERO, to: A, value: 900n * E18 },
        { block: 1n, from: ZERO, to: B, value: 100n * E18 },
        { block: 2n, from: A, to: B, value: 300n * E18 },
        { block: 3n, from: B, to: ZERO, value: 400n * E18 },
      ],
      new Map([[A, "curve" as const]]),
    );
    expect(count).toBe(1);
    expect(holders).toEqual([{ address: A, balance: 600, pct: 100, label: "curve" }]);
  });
});

describe("leaderboard", () => {
  const trade = (trader: `0x${string}` | null, side: "buy" | "sell", usd: number, token: `0x${string}` = TOKEN, symbol?: string): PricedTrade => ({
    venue: "pons",
    side,
    token,
    symbol,
    usd,
    tokens: 1,
    quoteSymbol: "ETH",
    trader,
    tx: `0x${"3".repeat(64)}`,
    blockNumber: 1n,
    logIndex: 0,
  });

  it("totals volume and net flow per wallet and names its most traded token", () => {
    const rows = rankTraders([
      trade(A, "buy", 100, TOKEN, "AAA"),
      trade(A, "sell", 40, TOKEN, "AAA"),
      trade(A, "buy", 10, B, "BBB"),
      trade(null, "buy", 999),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wallet: A, volumeUsd: 150, netUsd: 70, trades: 3, tokens: 2, topSymbol: "AAA" });
  });
});

describe("alerts", () => {
  const settings = { enabled: true, whaleUsd: 10_000, graduationPct: 90, followed: true };
  const radar = {
    trades: [
      { id: "t1", usd: 25_000, side: "buy", symbol: "NVDA", token: TOKEN, trader: B, venue: "stock" },
      { id: "t2", usd: 50, side: "sell", symbol: "PEPE", token: TOKEN, trader: A, venue: "pons" },
      { id: "t3", usd: 500, side: "buy", symbol: "X", token: TOKEN, trader: B, venue: "pons" },
    ],
  } as unknown as RadarSnapshot;
  const trenches = {
    graduating: [
      { curve: A, token: TOKEN, symbol: "HOT", progressPct: 93, raisedUsd: 10_000, thresholdUsd: 11_000, url: "u" },
      { curve: B, token: TOKEN, symbol: "COLD", progressPct: 40, raisedUsd: 1_000, thresholdUsd: 11_000, url: "u" },
    ],
    newest: [{ curve: B, token: TOKEN, symbol: "NEW", deployer: A, url: "u" }],
  } as unknown as TrenchesSnapshot;

  it("fires whale, graduation, followed-wallet and followed-launch alerts once each", () => {
    const seen = new Set<string>();
    const first = detectAlerts(radar, trenches, settings, new Set([A]), seen);
    expect(first.map((a) => a.kind).sort()).toEqual(["follow", "graduation", "launch", "whale"]);
    expect(detectAlerts(radar, trenches, settings, new Set([A]), seen)).toEqual([]);
  });
});
