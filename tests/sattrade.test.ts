import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { encodeSatSwap, satApproveData, satRoute, satRouterAbi, PONS_SWAP_ROUTER } from "@/lib/trade/sat";

const SAT = "0xBe3F794BFB99399A4eA9cd5aCf08529eeA6E718A";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

describe("SAT trading route", () => {
  it("buys ETH → USDG on v3, then USDG → SAT on the v4 pool with its hook", () => {
    const [v3, v4] = satRoute("buy");
    expect([v3.kind, v3.tokenIn, v3.tokenOut, v3.fee]).toEqual([1, WETH, USDG, 100]);
    expect([v4.kind, v4.tokenIn, v4.tokenOut, v4.fee, v4.tickSpacing]).toEqual([2, USDG, SAT, 0, 200]);
    expect(v4.hooks).toBe("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
    expect(v4.poolManager).toBe("0x8366a39CC670B4001A1121B8F6A443A643e40951");
  });

  it("sells along the same path backwards", () => {
    const [v4, v3] = satRoute("sell");
    expect([v4.tokenIn, v4.tokenOut]).toEqual([SAT, USDG]);
    expect([v3.tokenIn, v3.tokenOut]).toEqual([USDG, WETH]);
  });

  it("encodes the router call the way real SAT trades do", () => {
    const d = decodeFunctionData({ abi: satRouterAbi, data: encodeSatSwap("buy", 10n ** 16n, 123n) });
    const [route, recipient, amountIn, minOut, deadline] = d.args as unknown as [unknown[], string, bigint, bigint, bigint];
    expect(route).toHaveLength(2);
    // Address zero tells the router to pay the signer.
    expect(recipient).toBe("0x0000000000000000000000000000000000000000");
    expect([amountIn, minOut, deadline]).toEqual([10n ** 16n, 123n, 0n]);
  });

  it("approves exactly the amount being sold, to the router only", () => {
    const data = satApproveData(5n);
    expect(data.slice(0, 10)).toBe("0x095ea7b3");
    expect(data.toLowerCase()).toContain(PONS_SWAP_ROUTER.slice(2).toLowerCase());
    expect(BigInt(`0x${data.slice(-64)}`)).toBe(5n);
  });
});
