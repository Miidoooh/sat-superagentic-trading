import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SETTINGS, snapRadarSize } from "@/lib/alerts/detect";
import { describeRule, evaluateRules, newRuleState, planPoll, RuleSchema, type Rule } from "@/lib/alerts/rules";
import { QUOTE_ASSETS } from "@/lib/chain/constants";
import { computePnl } from "@/lib/portfolio/pnl";
import type { RadarSnapshot, WhaleTrade } from "@/lib/radar/whales";
import { MemoryKv, setKv } from "@/lib/store/kv";
import { sharedSnapshot } from "@/lib/store/snapshots";
import { curveFormulaOut, impactPct, spotOut } from "@/lib/trade/pons";
import { candidatePaths, encodePath } from "@/lib/trade/route";
import type { TokenMarket } from "@/lib/types";

const NVDA = "0x00000000000000000000000000000000000000a1" as const;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;
const WHALE = "0x1111111111111111111111111111111111111111" as const;

function whaleTrade(over: Partial<WhaleTrade> = {}): WhaleTrade {
  return {
    id: "0xabc:1",
    time: 0,
    block: "1",
    venue: "stock",
    side: "buy",
    token: NVDA,
    symbol: "NVDA",
    usd: 30_000,
    tokens: 150,
    quoteSymbol: "USDG",
    trader: WHALE,
    tx: `0x${"ab".repeat(32)}`,
    ...over,
  };
}

function radarWith(trades: WhaleTrade[], netUsd = 0): RadarSnapshot {
  return {
    head: "1",
    headTime: 0,
    windowMinutes: 30,
    minUsd: 0,
    trades,
    inflows: netUsd > 0 ? [{ token: NVDA, symbol: "NVDA", netUsd } as unknown as RadarSnapshot["inflows"][number]] : [],
    outflows: [],
    totals: {} as RadarSnapshot["totals"],
  };
}

const rule = (r: Partial<Rule> & Pick<Rule, "kind">): Rule => RuleSchema.parse({ id: "r1", text: "", enabled: true, ...r });

describe("computePnl", () => {
  it("prices open and closed parts from average cost", () => {
    const r = computePnl(
      [
        { side: "buy", amount: 10, usd: 100 },
        { side: "buy", amount: 10, usd: 300 },
        { side: "sell", amount: 5, usd: 150 },
      ],
      15,
      40,
    );
    expect(r.avgCostUsd).toBe(20);
    expect(r.realizedUsd).toBe(50);
    expect(r.unrealizedUsd).toBe(300);
    expect(r.coveredPct).toBe(100);
  });

  it("only counts the part of the balance the window explains", () => {
    const r = computePnl([{ side: "buy", amount: 5, usd: 50 }], 20, 20);
    expect(r.unrealizedUsd).toBe(50);
    expect(r.coveredPct).toBe(25);
  });

  it("has no cost basis without buys", () => {
    const r = computePnl([], 10, 5);
    expect(r.avgCostUsd).toBeNull();
    expect(r.unrealizedUsd).toBeNull();
  });
});

describe("rules", () => {
  it("rejects price rules without a token or a level", () => {
    expect(RuleSchema.safeParse({ id: "x", kind: "price", priceAbove: 5 }).success).toBe(false);
    expect(RuleSchema.safeParse({ id: "x", kind: "price", token: NVDA }).success).toBe(false);
  });

  it("matches trade rules on side, size, token and net flow", () => {
    const r = rule({ kind: "trade", token: NVDA, side: "buy", minUsd: 25_000, netFlowUsd: 5_000 });
    const ctx = { trenches: null, markets: null };
    expect(evaluateRules([r], { ...ctx, radar: radarWith([whaleTrade()], 1_000) }, newRuleState())).toHaveLength(0);
    expect(evaluateRules([r], { ...ctx, radar: radarWith([whaleTrade({ usd: 10_000 })], 9_000) }, newRuleState())).toHaveLength(0);
    expect(evaluateRules([r], { ...ctx, radar: radarWith([whaleTrade({ side: "sell" })], 9_000) }, newRuleState())).toHaveLength(0);
    const hits = evaluateRules([r], { ...ctx, radar: radarWith([whaleTrade()], 9_000) }, newRuleState());
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("rule");
  });

  it("never fires the same trade twice or a paused rule", () => {
    const r = rule({ kind: "trade", minUsd: 1_000 });
    const state = newRuleState();
    const ctx = { radar: radarWith([whaleTrade()]), trenches: null, markets: null };
    expect(evaluateRules([r], ctx, state)).toHaveLength(1);
    expect(evaluateRules([r], ctx, state)).toHaveLength(0);
    expect(evaluateRules([{ ...r, enabled: false }], ctx, newRuleState())).toHaveLength(0);
  });

  it("fires price rules on the crossing and re-arms after", () => {
    const r = rule({ kind: "price", token: NVDA, tokenSymbol: "NVDA", priceAbove: 200 });
    const state = newRuleState();
    const at = (priceUsd: number) => ({
      radar: null,
      trenches: null,
      markets: [{ token: { address: NVDA, symbol: "NVDA" }, priceUsd, priceChange1hPct: null } as unknown as TokenMarket],
    });
    expect(evaluateRules([r], at(210), state)).toHaveLength(1);
    expect(evaluateRules([r], at(220), state)).toHaveLength(0);
    expect(evaluateRules([r], at(190), state)).toHaveLength(0);
    expect(evaluateRules([r], at(205), state)).toHaveLength(1);
  });

  it("describes rules in plain words", () => {
    expect(describeRule(rule({ kind: "trade", tokenSymbol: "NVDA", token: NVDA, side: "buy", minUsd: 25_000 }))).toBe("A buy of $25.0K+ in NVDA");
    expect(describeRule(rule({ kind: "curve", progressPct: 95 }))).toBe("Any Pons curve reaches 95% to graduation");
  });

  it("plans one poll that covers built-in alerts and every rule", () => {
    const plan = planPoll({ ...DEFAULT_ALERT_SETTINGS, whaleUsd: 10_000 }, [WHALE], [rule({ kind: "trade", minUsd: 3_000 }), rule({ kind: "price", token: NVDA, priceBelow: 1 })]);
    expect(plan.minUsd).toBe(2_500);
    expect(plan.wallets).toEqual([WHALE]);
    expect(plan.markets).toBe(true);
    expect(snapRadarSize(10)).toBe(250);
    expect(snapRadarSize(1_000_000)).toBe(100_000);
  });
});

describe("routing", () => {
  const usdg = QUOTE_ASSETS.find((q) => q.symbol === "USDG")!;
  const market = { token: { address: NVDA }, feeTier: 3000, quoteSymbol: "USDG" } as unknown as TokenMarket;

  it("encodes Uniswap v3 paths as token, fee, token", () => {
    const path = encodePath([WETH, NVDA], [500]);
    expect(path.length).toBe(2 + 2 * (20 + 3 + 20));
    expect(path.slice(42, 48)).toBe("0001f4");
  });

  it("routes stock buys through the pool's quote asset and reverses for sells", () => {
    const buys = candidatePaths(market, "buy", WETH);
    expect(buys.length).toBeGreaterThan(0);
    for (const p of buys) {
      expect(p.tokens[1].toLowerCase()).toBe(usdg.address.toLowerCase());
      expect(p.fees[1]).toBe(3000);
    }
    const sells = candidatePaths(market, "sell", WETH);
    expect(sells[0].tokens[0].toLowerCase()).toBe(NVDA);
    expect(sells[0].tokens.at(-1)).toBe(WETH);
  });
});

describe("pons curve math", () => {
  it("takes the 1% fee before the constant-product step", () => {
    const out = curveFormulaOut(10n ** 18n, 10n * 10n ** 18n, 1_000_000n * 10n ** 18n);
    const noFee = (1_000_000n * 10n ** 18n * 10n ** 18n) / (11n * 10n ** 18n);
    expect(out < noFee).toBe(true);
    const impact = impactPct(out, spotOut(10n ** 18n, 10n * 10n ** 18n, 1_000_000n * 10n ** 18n));
    expect(impact).toBeGreaterThan(9);
    expect(impact).toBeLessThan(11);
  });
});

describe("shared store", () => {
  afterEach(() => setKv(undefined));

  it("computes directly when no shared store is configured", async () => {
    setKv(new MemoryKv());
    const compute = vi.fn(async () => 42);
    expect(await sharedSnapshot("k", 1_000, compute)).toBe(42);
    expect(await sharedSnapshot("k", 1_000, compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("expires values after their ttl", async () => {
    const kv = new MemoryKv();
    await kv.set("a", { x: 1 }, 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await kv.get("a")).toBeNull();
  });
});

describe("telegram linking", () => {
  const sent: string[] = [];
  beforeEach(() => {
    setKv(new MemoryKv());
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_BOT_USERNAME = "sat_test_bot";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body).text);
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setKv(undefined);
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    sent.length = 0;
  });

  it("links a chat through /start and unlinks with /stop", async () => {
    const tg = await import("@/lib/telegram/telegram");
    const cfg = tg.telegramConfig()!;
    const code = await tg.createLinkCode();
    expect(await tg.checkLinkCode(code)).toBeNull();

    await tg.handleUpdate(cfg, { update_id: 1, message: { chat: { id: 77, type: "private" }, text: `/start ${code}` } });
    const token = await tg.checkLinkCode(code);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect((await tg.getSubscription(token!))?.chatId).toBe(77);
    expect(await tg.listSubscriptions()).toHaveLength(1);

    expect(await tg.markSent(token!, "a1")).toBe(true);
    expect(await tg.markSent(token!, "a1")).toBe(false);

    await tg.handleUpdate(cfg, { update_id: 2, message: { chat: { id: 77, type: "private" }, text: "/stop" } });
    expect(await tg.getSubscription(token!)).toBeNull();
    expect(sent.some((t) => t.startsWith("Linked to SAT"))).toBe(true);
  });

  it("refuses unknown or expired codes", async () => {
    const tg = await import("@/lib/telegram/telegram");
    await expect(tg.checkLinkCode("0".repeat(18))).rejects.toThrow(/expired/);
  });
});
