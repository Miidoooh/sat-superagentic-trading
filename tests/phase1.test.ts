import { describe, expect, it } from "vitest";
import { classifySocials, logoUrlOf } from "@/lib/data/ponsProfile";
import { pairPerToken, v4PoolId } from "@/lib/data/v4";
import { rankSearch, type SearchEntry } from "@/lib/search/index";

describe("pons profiles", () => {
  it("serves ipfs logos through our own proxy and rejects junk", () => {
    expect(logoUrlOf("ipfs://Qmagtam9XPCVrEwNakzzua8kB4kyfkAa7412L7HaPrV42x")).toBe("/api/ipfs/Qmagtam9XPCVrEwNakzzua8kB4kyfkAa7412L7HaPrV42x");
    expect(logoUrlOf("ipfs://bafkreihcp42qadaita647hjzefvkbhqouswg46hgpstplz2vp75n6luaty")).toMatch(/^\/api\/ipfs\/bafk/);
    expect(logoUrlOf("javascript:alert(1)")).toBeNull();
    expect(logoUrlOf("")).toBeNull();
  });
  it("classifies social links by where they point, not by slot", () => {
    expect(classifySocials(["https://x.com/sat_hood/all", "", "", "https://www.sathood.xyz/", ""])).toEqual({
      twitter: "https://x.com/sat_hood/all",
      website: "https://www.sathood.xyz/",
    });
    expect(classifySocials(["t.me/fuelpays", "https://discord.gg/abc", "javascript:alert(1)"])).toEqual({
      telegram: "https://t.me/fuelpays",
      discord: "https://discord.gg/abc",
    });
  });
});

describe("uniswap v4 graduated pools", () => {
  it("hashes the SAT pool key to its on-chain id", () => {
    expect(
      v4PoolId({
        currency0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        currency1: "0xBe3F794BFB99399A4eA9cd5aCf08529eeA6E718A",
        fee: 0,
        tickSpacing: 200,
        hooks: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
      }),
    ).toBe("0xea8f2ad501f0adbd94dac5e04e59a0a29a56cd97a0a35a57ec5989f9716687f4");
  });
  it("prices the launch token whichever side of the pool it sits on", () => {
    const sqrt = 10423405160440396265066190121002255637n;
    // SAT is currency1 against 6-decimal USDG: about $0.0000578.
    const usd = pairPerToken(sqrt, false, 6);
    expect(usd).toBeGreaterThan(5.7e-5);
    expect(usd).toBeLessThan(5.9e-5);
    // The same pool read with the token as currency0 is the reciprocal side.
    expect(pairPerToken(2n ** 96n, true, 18)).toBeCloseTo(1, 10);
  });
});

describe("token search", () => {
  const e = (symbol: string, name: string, kind: SearchEntry["kind"], address: string, weight = 0): SearchEntry => ({
    symbol,
    name,
    kind,
    address: address as `0x${string}`,
    weight,
  });
  const OFFICIAL = "0xbe3f794bfb99399a4ea9cd5acf08529eea6e718a";
  const entries = [
    e("SAT", "Copycat", "pons", "0x1111111111111111111111111111111111111111"),
    e("SATURN", "Saturn", "graduated", "0x2222222222222222222222222222222222222222"),
    e("SAT", "Strategic Agentic Trading", "graduated", OFFICIAL),
    e("NVDA", "NVIDIA", "stock", "0x3333333333333333333333333333333333333333", 1e6),
  ];
  it("puts the official token ahead of copycats with the same ticker", () => {
    const r = rankSearch(entries, "sat", 10, OFFICIAL);
    expect(r[0].address).toBe(OFFICIAL);
    expect(r.map((x) => x.symbol)).toEqual(["SAT", "SAT", "SATURN"]);
  });
  it("matches names and ignores a leading $", () => {
    expect(rankSearch(entries, "$nvidia")[0].symbol).toBe("NVDA");
    expect(rankSearch(entries, "zzz")).toEqual([]);
  });
});
