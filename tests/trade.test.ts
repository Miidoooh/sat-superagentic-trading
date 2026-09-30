import { beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { resetConfigCache, getConfig } from "../src/lib/config";
import { buildTrade, validateIntent } from "../src/lib/trade/trade";
import type { TokenMarket } from "../src/lib/types";

const TOKEN = "0x00000000000000000000000000000000000000a1" as const;
const ROUTER = "0x00000000000000000000000000000000000000b2";
const WETH = "0x00000000000000000000000000000000000000c3";
const WALLET = "0x00000000000000000000000000000000000000d4";

const market: TokenMarket = {
  token: { address: TOKEN, symbol: "TST", name: "Test", decimals: 18 },
  poolAddress: "0x00000000000000000000000000000000000000e5",
  feeTier: 3000,
  quoteSymbol: "USDG",
  priceUsd: 10,
  oraclePriceUsd: 10,
  oracleBasisPct: 0,
  oracleUpdatedAt: 0,
  oracleStale: false,
  liquidityUsd: 1_000_000,
  volume24hUsd: 100_000,
  priceChange1hPct: 0,
  priceChange24hPct: 0,
  txCount24h: 10,
  createdAt: 0,
  tradableNow: true,
  hasPriceHistory: true,
  venue: "uniswap-v3",
};

beforeEach(() => {
  process.env.RH_SWAP_ROUTER = ROUTER;
  process.env.RH_WRAPPED_NATIVE = WETH;
  process.env.SAT_ENABLE_TRADING = "true";
  process.env.SAT_MAX_TRADE_NATIVE = "0.05";
  process.env.SAT_MAX_SLIPPAGE_BPS = "100";
  resetConfigCache();
});

describe("trade guardrails", () => {
  it("blocks oversized buys", () => {
    const errs = validateIntent({ side: "buy", token: TOKEN, amount: 1 }, market, 3000);
    expect(errs.join(" ")).toMatch(/guardrail/);
  });

  it("blocks excessive slippage", () => {
    const errs = validateIntent({ side: "buy", token: TOKEN, amount: 0.01, slippageBps: 500 }, market, 3000);
    expect(errs.join(" ")).toMatch(/Slippage/);
  });

  it("blocks illiquid pools", () => {
    const errs = validateIntent({ side: "buy", token: TOKEN, amount: 0.01 }, { ...market, liquidityUsd: 500 }, 3000);
    expect(errs.join(" ")).toMatch(/liquidity/);
  });

  it("blocks trades that are a large share of the pool", () => {
    const errs = validateIntent({ side: "buy", token: TOKEN, amount: 0.05 }, { ...market, liquidityUsd: 5_000 }, 3000);
    expect(errs.join(" ")).toMatch(/price impact/);
  });

  it("is disabled unless trading is explicitly turned on", () => {
    process.env.SAT_ENABLE_TRADING = "false";
    resetConfigCache();
    expect(validateIntent({ side: "buy", token: TOKEN, amount: 0.01 }, market, 3000).join(" ")).toMatch(/disabled/);
  });

  it("passes a sane trade", () => {
    expect(validateIntent({ side: "buy", token: TOKEN, amount: 0.01 }, market, 3000)).toEqual([]);
  });
});

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

describe("buildTrade", () => {
  it("encodes a buy with native value and slippage-protected minOut", () => {
    const built = buildTrade({ side: "buy", token: TOKEN, amount: 0.01 }, market, 3000, { wallet: WALLET });
    expect(built.steps).toHaveLength(1);
    const step = built.steps[0];
    expect(step.to.toLowerCase()).toBe(ROUTER);
    expect(step.value).toBe("10000000000000000");
    const { args } = decodeFunctionData({ abi: routerAbi, data: step.data });
    const p = args![0];
    expect(p.tokenIn.toLowerCase()).toBe(WETH);
    expect(p.tokenOut.toLowerCase()).toBe(TOKEN);
    expect(p.recipient.toLowerCase()).toBe(WALLET);
    // 0.01 * 3000 / 10 = 3 tokens, less 0.3% fee, less 1% slippage
    const expected = 3 * 0.997 * 0.99;
    expect(Number(p.amountOutMinimum) / 1e18).toBeCloseTo(expected, 6);
  });

  it("adds an exact approval on sells when allowance is short, and skips it when sufficient", () => {
    const short = buildTrade({ side: "sell", token: TOKEN, amount: 1 }, market, 3000, { wallet: WALLET, currentAllowance: 0n });
    expect(short.steps).toHaveLength(2);
    expect(short.steps[0].label).toMatch(/Approve exactly/);
    const enough = buildTrade({ side: "sell", token: TOKEN, amount: 1 }, market, 3000, { wallet: WALLET, currentAllowance: 10n ** 18n });
    expect(enough.steps).toHaveLength(1);
  });

  it("throws when guardrails fail", () => {
    expect(() => buildTrade({ side: "buy", token: TOKEN, amount: 5 }, market, 3000, { wallet: WALLET })).toThrow();
  });

  it("defaults to Robinhood Chain mainnet", () => {
    expect(getConfig().RH_CHAIN_ID).toBe(4663);
    expect(getConfig().RH_RPC_URL).toBe("https://rpc.mainnet.chain.robinhood.com");
  });
});
