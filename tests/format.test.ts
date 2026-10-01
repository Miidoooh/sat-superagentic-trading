import { describe, expect, it } from "vitest";
import { fmtPrice, fmtUsd } from "@/lib/format";

describe("fmtPrice", () => {
  it("collapses long runs of zeros into a subscript count", () => {
    expect(fmtPrice(0.00000394)).toBe("0.0₅394");
    expect(fmtPrice(0.0000578)).toBe("0.0₄578");
    expect(fmtPrice(0.000000000123)).toBe("0.0₉123");
    expect(fmtPrice(0.0000500)).toBe("0.0₄5");
  });
  it("keeps ordinary prices ordinary", () => {
    expect(fmtPrice(231.26)).toBe("231.26");
    expect(fmtPrice(1089.1)).toBe("1,089.1");
    expect(fmtPrice(0.0123)).toBe("0.0123");
    expect(fmtPrice(0.00042)).toBe("0.000420");
    expect(fmtPrice(null)).toBe("—");
  });
});

describe("fmtUsd compact", () => {
  it("drops cents once they stop mattering", () => {
    expect(fmtUsd(445.88, { compact: true })).toBe("$446");
    expect(fmtUsd(44.6, { compact: true })).toBe("$44.60");
    expect(fmtUsd(4600, { compact: true })).toBe("$4.6K");
    expect(fmtUsd(58_310_000, { compact: true })).toBe("$58.31M");
    expect(fmtUsd(0.0002692, { compact: true })).toBe("$0.00");
    expect(fmtUsd(0.27, { compact: true })).toBe("$0.27");
  });
});
