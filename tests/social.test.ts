import { describe, expect, it } from "vitest";
import { buzzLine, socialAlerts } from "@/lib/social/posts";
import { buzzOf, tokensIn, toPost } from "@/lib/social/radar";

const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;
const byAddress = new Map([
  [A, { token: A, symbol: "PEPE" }],
  [B, { token: B, symbol: "ANTS" }],
]);
const bySymbol = new Map([
  ["pepe", { token: A, symbol: "PEPE" }],
  ["ants", { token: B, symbol: "ANTS" }],
  ["eth", { token: A, symbol: "ETH" }],
]);

const tweet = (id: string, text: string, followers: number, user = "kol", createdAt = new Date(1_800_000_000_000).toUTCString()) => ({
  id,
  text,
  createdAt,
  author: { userName: user, name: user, followers },
});

describe("X radar matching", () => {
  it("maps contract addresses and our cashtags to tokens, ignoring generic tickers", () => {
    expect(tokensIn(`aping ${A.toUpperCase().replace("0X", "0x")} now`, byAddress, bySymbol).map((t) => t.symbol)).toEqual(["PEPE"]);
    expect(tokensIn("$ANTS and $PEPE are running", byAddress, bySymbol).map((t) => t.symbol)).toEqual(["ANTS", "PEPE"]);
    expect(tokensIn("$ETH to the moon", byAddress, bySymbol)).toEqual([]);
    expect(tokensIn("$PEPE and again $PEPE", byAddress, bySymbol)).toHaveLength(1);
  });

  it("alerts only on token posts from big accounts, naming the account and its reach", () => {
    const big = toPost(tweet("1", "$PEPE looks ready", 180_000, "whalecaller"), [{ token: A, symbol: "PEPE" }]);
    const small = toPost(tweet("2", "$PEPE", 300, "anon"), [{ token: A, symbol: "PEPE" }]);
    const chatter = toPost(tweet("3", "robinhood chain is cooking", 500_000, "vc"), []);
    const alerts = socialAlerts([big, small, chatter], 10_000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: "x:1", kind: "social", token: A });
    expect(alerts[0].title).toBe("📣 @whalecaller (180K followers) on $PEPE");
  });

  it("sums buzz per token, counting each author's reach once", () => {
    const now = 1_800_000_000;
    const posts = [
      toPost(tweet("1", "$PEPE", 50_000, "a"), [{ token: A, symbol: "PEPE" }]),
      toPost(tweet("2", "$PEPE again", 50_000, "a"), [{ token: A, symbol: "PEPE" }]),
      toPost(tweet("3", "$PEPE", 2_000, "b"), [{ token: A, symbol: "PEPE" }]),
    ];
    const [pepe] = buzzOf(posts, now);
    expect(pepe).toMatchObject({ symbol: "PEPE", mentions24h: 3, mentions1h: 3, reach24h: 52_000, top: { userName: "a", followers: 50_000 } });
    expect(buzzLine(pepe)).toBe("3 posts on X in 24h, top @a (50K)");
  });
});
