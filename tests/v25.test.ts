import { decodeFunctionData, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { topTokenBuyers, type FlowReport } from "@/lib/report/flow";
import { safetyScore, type SafetyInput } from "@/lib/safety/score";
import { poolId, SAT_POOL_KEY, satUsdFromSqrt } from "@/lib/sat/token";
import { nextTier, tierFor, TIERS } from "@/lib/sat/tiers";
import { verifyHolderProof } from "@/lib/sat/verify";
import { formatReport } from "@/lib/telegram/telegram";
import { encodeRoutedBuy, encodeRoutedSell, netOfFee, router02Abi, type SwapRoute } from "@/lib/trade/route";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const FEE_WALLET = "0x10Acd70eeEb62dD762F1518D8aC687C77C484a76" as const;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
const NVDA = "0x00000000000000000000000000000000000000a1" as const;

describe("holder tiers", () => {
  const t = { holderUsd: 50, whaleUsd: 500 };
  it("ranks wallets by the USD value of their SAT", () => {
    expect(tierFor(0, t)).toBe("free");
    expect(tierFor(49.99, t)).toBe("free");
    expect(tierFor(50, t)).toBe("holder");
    expect(tierFor(500, t)).toBe("whale");
  });
  it("says how far the next tier is", () => {
    expect(nextTier(20, t)).toEqual({ id: "holder", needUsd: 30 });
    expect(nextTier(120, t)).toEqual({ id: "whale", needUsd: 380 });
    expect(nextTier(900, t)).toBeNull();
  });
  it("gives holders more rules and no Telegram delay", () => {
    expect(TIERS.free.maxRules).toBeLessThan(TIERS.holder.maxRules);
    expect(TIERS.holder.maxRules).toBeLessThan(TIERS.whale.maxRules);
    expect(TIERS.free.telegramDelayMs).toBeGreaterThan(0);
    expect(TIERS.holder.telegramDelayMs).toBe(0);
  });
  it("rejects stale holder signatures before touching the chain", async () => {
    const proof = { wallet: WALLET, issuedAt: Date.now() - 60 * 60_000, signature: "0x00" };
    await expect(verifyHolderProof(proof)).rejects.toThrow(/expired/);
  });
});

describe("SAT v4 pool", () => {
  it("derives the pool id seen in the graduation transaction", () => {
    expect(poolId(SAT_POOL_KEY)).toBe("0xea8f2ad501f0adbd94dac5e04e59a0a29a56cd97a0a35a57ec5989f9716687f4");
  });
  it("turns sqrtPriceX96 into USD per SAT", () => {
    // ~17,300 SAT per USDG at this price.
    const usd = satUsdFromSqrt(10423405160440396265066190121002255637n);
    expect(usd).toBeGreaterThan(5.7e-5);
    expect(usd).toBeLessThan(5.9e-5);
  });
});

describe("trade fee", () => {
  const route: SwapRoute = { tokens: [WETH, USDG, NVDA], fees: [500, 3000], amountIn: 10n ** 16n, amountOut: 116_784_215_674_565_465n };
  it("nets the fee out of what the wallet receives", () => {
    expect(netOfFee(10_000n, { bips: 50, recipient: FEE_WALLET })).toBe(9_950n);
    expect(netOfFee(10_000n, null)).toBe(10_000n);
  });
  it("sweeps a buy's output through sweepTokenWithFee", () => {
    const data = encodeRoutedBuy(route, 1000n, WALLET, { bips: 50, recipient: FEE_WALLET });
    const outer = decodeFunctionData({ abi: router02Abi, data });
    expect(outer.functionName).toBe("multicall");
    const [calls] = outer.args as [readonly `0x${string}`[]];
    const sweep = decodeFunctionData({ abi: router02Abi, data: calls[1] });
    expect(sweep.functionName).toBe("sweepTokenWithFee");
    expect(sweep.args).toEqual([getAddress(NVDA), 1000n, WALLET, 50n, FEE_WALLET]);
  });
  it("unwraps a sell with unwrapWETH9WithFee", () => {
    const sell: SwapRoute = { ...route, tokens: [...route.tokens].reverse(), fees: [...route.fees].reverse() };
    const [calls] = decodeFunctionData({ abi: router02Abi, data: encodeRoutedSell(sell, 7n, WALLET, { bips: 50, recipient: FEE_WALLET }) }).args as [
      readonly `0x${string}`[],
    ];
    const unwrap = decodeFunctionData({ abi: router02Abi, data: calls[1] });
    expect(unwrap.functionName).toBe("unwrapWETH9WithFee");
    expect(unwrap.args).toEqual([7n, WALLET, 50n, FEE_WALLET]);
  });
  it("keeps the plain path when no fee is set", () => {
    expect(decodeFunctionData({ abi: router02Abi, data: encodeRoutedBuy(route, 1n, WALLET) }).functionName).toBe("exactInput");
  });
});

describe("launch safety score", () => {
  const base: SafetyInput = {
    ageSeconds: 3 * 3600,
    deployer: "0xdddddddddddddddddddddddddddddddddddddddd",
    holders: [
      { address: "0xcccccccccccccccccccccccccccccccccccccccc", pct: 60, label: "curve" },
      ...Array.from({ length: 12 }, (_, i) => ({ address: `0x${String(i).padStart(40, "a")}`, pct: 2, label: null })),
    ],
    trades: [
      { side: "buy", usd: 500, trader: "0x1" },
      { side: "buy", usd: 400, trader: "0x2" },
      { side: "sell", usd: 200, trader: "0x3" },
    ],
    traders: 60,
    raisedUsd: 4_000,
  };
  it("scores a spread-out launch as lower risk", () => {
    const s = safetyScore(base);
    expect(s.grade).toBe("lower");
    expect(s.flags.every((f) => f.tone !== "bad")).toBe(true);
  });
  it("flags a deployer who holds a lot and dumped", () => {
    const s = safetyScore({
      ...base,
      holders: [...base.holders, { address: base.deployer, pct: 18, label: "deployer" }],
      trades: [...base.trades, { side: "buy", usd: 100, trader: base.deployer }, { side: "sell", usd: 900, trader: base.deployer }],
    });
    expect(s.grade).not.toBe("lower");
    expect(s.flags.filter((f) => f.tone === "bad").map((f) => f.text).join(" ")).toMatch(/Deployer/);
  });
  it("never leaves 0-100", () => {
    const s = safetyScore({ ...base, traders: 1, ageSeconds: 30, holders: [{ address: base.deployer, pct: 90, label: "deployer" }] });
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});

describe("report smart money", () => {
  it("ranks wallets by net token buys and names the token each bought most", () => {
    const A = "0x000000000000000000000000000000000000000a" as const;
    const B = "0x000000000000000000000000000000000000000b" as const;
    const PEPE = "0x0000000000000000000000000000000000000001" as const;
    const DOGE = "0x0000000000000000000000000000000000000002" as const;
    const rows = topTokenBuyers(
      [
        { token: PEPE, symbol: "PEPE", side: "buy", usd: 900, trader: A },
        { token: DOGE, symbol: "DOGE", side: "buy", usd: 300, trader: A },
        { token: DOGE, symbol: "DOGE", side: "sell", usd: 100, trader: A },
        { token: DOGE, symbol: "DOGE", side: "buy", usd: 2_000, trader: B },
        { token: DOGE, symbol: "DOGE", side: "sell", usd: 1_900, trader: B },
        { token: PEPE, symbol: "PEPE", side: "buy", usd: 50, trader: null },
      ],
      3,
    );
    expect(rows.map((r) => [r.wallet, r.netUsd, r.topSymbol])).toEqual([
      [A, 1_100, "PEPE"],
      [B, 100, "DOGE"],
    ]);
  });
});

describe("daily report caption", () => {
  it("leads with token volume and the hottest tokens, and links back to the site", () => {
    const r = {
      date: "2026-10-01",
      totals: { volumeUsd: 58_310_000, trades: 100_376, wallets: 2859, stockUsd: 57_000_000, ponsUsd: 1_310_000, buySharePct: 50 },
      pons: { launches: 419, graduations: 3, graduated: [] },
      inflows: [{ symbol: "PEPE", netUsd: 44_300 }],
      outflows: [{ symbol: "RUG", netUsd: -21_400 }],
      biggestBuys: [{ symbol: "PEPE", usd: 12_000 }],
    } as unknown as FlowReport;
    const text = formatReport(r, "https://sathood.xyz");
    expect(text).toContain("$1.31M token volume");
    expect(text).not.toContain("$58.31M");
    expect(text).toContain("PEPE +$44.3K");
    expect(text).toContain("$12.0K buy of PEPE");
    expect(text).toContain("https://sathood.xyz/report");
  });
});
