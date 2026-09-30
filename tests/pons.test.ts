import { describe, expect, it } from "vitest";
import { curveSpotUsd } from "../src/lib/data/pons";

describe("curveSpotUsd", () => {
  it("prices one token from constant-product reserves", () => {
    // 1 ETH of quote against 500 tokens, ETH at $3,000 → $6 per token.
    const price = curveSpotUsd(10n ** 18n, 500n * 10n ** 18n, 18, 18, 3000);
    expect(price).toBeCloseTo(6, 8);
  });

  it("rescales a 6-decimal stable quote", () => {
    // 1,000 USDG (6 decimals) against 1,000,000 tokens → $0.001.
    const price = curveSpotUsd(1_000n * 10n ** 6n, 1_000_000n * 10n ** 18n, 6, 18, 1);
    expect(price).toBeCloseTo(0.001, 10);
  });

  it("returns null for an empty or broken curve", () => {
    expect(curveSpotUsd(0n, 10n ** 18n, 18, 18, 3000)).toBeNull();
    expect(curveSpotUsd(10n ** 18n, 0n, 18, 18, 3000)).toBeNull();
    expect(curveSpotUsd(10n ** 18n, 10n ** 18n, 18, 18, 0)).toBeNull();
  });
});
