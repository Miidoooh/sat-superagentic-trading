import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "@/lib/cache";
import { getLogsAdaptive, isRateLimited, RollingWindow } from "@/lib/chain/logs";
import { curveProgress, type PonsLaunch, type QuoteBook } from "@/lib/data/pons";
import { pickTrader, type RawCurveTrade } from "@/lib/data/ponsFlow";
import { flowByCurve } from "@/lib/radar/trenches";
import { aggregateFlows, classifySwap, priceCurveTrades, stockIsToken0 } from "@/lib/radar/whales";

const ETH = "0x0000000000000000000000000000000000000000" as const;
const CURVE = "0x00000000000000000000000000000000000000c1" as const;
const TOKEN = "0x00000000000000000000000000000000000000a1" as const;
const PONS_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948" as const;
const WALLET = "0x1111111111111111111111111111111111111111" as const;

const launch: PonsLaunch = {
  token: TOKEN,
  curve: CURVE,
  deployer: WALLET,
  pairToken: ETH,
  threshold: 4_200000000000000000n,
  block: 1n,
};
const book: QuoteBook = { ethUsd: 2_000, byAddress: new Map() };

function trade(side: "buy" | "sell", ethWei: bigint, trader: `0x${string}` | null = WALLET, block = 10n): RawCurveTrade {
  return { block, curve: CURVE, side, quoteGross: ethWei, tokens: 1_000n * 10n ** 18n, trader, tx: `0x${"ab".repeat(32)}`, logIndex: Number(block) };
}

describe("RollingWindow", () => {
  it("only fetches new blocks after the first fill and drops what ages out", async () => {
    const fetchRange = vi.fn(async (from: bigint, to: bigint) => {
      const out = [];
      for (let b = from; b <= to; b++) out.push({ block: b });
      return out;
    });
    const w = new RollingWindow(10n, fetchRange);

    expect((await w.refresh(100n)).map((i) => i.block)).toEqual([91n, 92n, 93n, 94n, 95n, 96n, 97n, 98n, 99n, 100n]);
    expect(fetchRange).toHaveBeenLastCalledWith(90n, 100n);

    const next = await w.refresh(103n);
    expect(fetchRange).toHaveBeenLastCalledWith(101n, 103n);
    expect(next[0].block).toBe(94n);
    expect(next.at(-1)?.block).toBe(103n);

    await w.refresh(103n);
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });

  it("refills from scratch after a gap longer than the window", async () => {
    const fetchRange = vi.fn(async (_from: bigint, to: bigint) => [{ block: to }]);
    const w = new RollingWindow(10n, fetchRange);
    await w.refresh(100n);
    await w.refresh(500n);
    expect(fetchRange).toHaveBeenLastCalledWith(490n, 500n);
  });
});

describe("getLogsAdaptive", () => {
  it("halves the range when the node rejects it", async () => {
    const calls: [bigint, bigint][] = [];
    const out = await getLogsAdaptive(0n, 99n, async (from, to) => {
      calls.push([from, to]);
      if (to - from > 30n) throw new Error("query returned more than 10000 results");
      return [from];
    });
    expect(out).toEqual([0n, 25n, 50n, 75n]);
    expect(calls[0]).toEqual([0n, 99n]);
  });

  it("recognises rate limiting anywhere in the error chain", () => {
    expect(isRateLimited(new Error("fine"))).toBe(false);
    expect(isRateLimited({ message: "HTTP request failed", cause: { status: 429 } })).toBe(true);
    expect(isRateLimited({ details: "Too Many Requests" })).toBe(true);
    expect(isRateLimited({ message: 'Request body: {"address":"0xabc429def"}', details: "query spans too many blocks" })).toBe(false);
  });
});

describe("TtlCache stale-while-revalidate", () => {
  it("serves the stale value immediately and refreshes in the background", async () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlCache();
      expect(await cache.get("k", 1000, async () => 1, { swr: true })).toBe(1);
      vi.advanceTimersByTime(2000);

      let resolve!: (v: number) => void;
      const slow = new Promise<number>((r) => (resolve = r));
      expect(await cache.get("k", 1000, () => slow, { swr: true })).toBe(1);
      resolve(2);
      await slow;
      await Promise.resolve();
      expect(await cache.get("k", 1000, async () => 3, { swr: true })).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("curve maths", () => {
  it("measures progress against the graduation threshold and clamps it", () => {
    expect(curveProgress(2_100000000000000000n, 4_200000000000000000n)).toBe(0.5);
    expect(curveProgress(9n * 10n ** 18n, 4_200000000000000000n)).toBe(1);
    expect(curveProgress(0n, 4_200000000000000000n)).toBe(0);
    expect(curveProgress(1n, 0n)).toBe(0);
  });
});

describe("swap classification", () => {
  it("orders pool tokens by address", () => {
    expect(stockIsToken0("0x0a", "0x0b")).toBe(true);
    expect(stockIsToken0("0xBB", "0xaa")).toBe(false);
  });

  it("treats Stock Tokens leaving the pool as a buy", () => {
    expect(classifySwap(-5n, 100n, true)).toEqual({ side: "buy", stock: 5n });
    expect(classifySwap(100n, 5n, false)).toEqual({ side: "sell", stock: 5n });
  });

  it("names the wallet, not the router", () => {
    expect(pickTrader(PONS_ROUTER, WALLET)).toBe(WALLET);
    expect(pickTrader(WALLET, PONS_ROUTER)).toBe(WALLET);
    expect(pickTrader(PONS_ROUTER)).toBeNull();
  });
});

describe("curve trade pricing and flow", () => {
  it("prices trades in USD and drops curves the Pons factory did not launch", () => {
    const foreign = { ...trade("buy", 10n ** 18n), curve: "0x00000000000000000000000000000000000000ff" as const };
    const priced = priceCurveTrades([trade("buy", 10n ** 18n), foreign], [launch], book);
    expect(priced).toHaveLength(1);
    expect(priced[0].usd).toBeCloseTo(2_000);
    expect(priced[0].token).toBe(TOKEN);
  });

  it("nets buys against sells per token and counts distinct wallets", () => {
    const priced = priceCurveTrades(
      [trade("buy", 2n * 10n ** 18n), trade("sell", 5n * 10n ** 17n, "0x2222222222222222222222222222222222222222"), trade("buy", 10n ** 17n, null)],
      [launch],
      book,
    );
    const [row] = aggregateFlows(priced);
    expect(row.buyUsd).toBeCloseTo(4_200);
    expect(row.sellUsd).toBeCloseTo(1_000);
    expect(row.netUsd).toBeCloseTo(3_200);
    expect(row.trades).toBe(3);
    expect(row.traders).toBe(2);
  });

  it("groups trenches flow by curve", () => {
    const flows = flowByCurve([trade("buy", 10n ** 18n), trade("sell", 10n ** 18n)], [launch], book);
    expect(flows.get(CURVE)).toEqual({ buyUsd: 2_000, sellUsd: 2_000, trades: 2, traders: 1 });
  });
});
