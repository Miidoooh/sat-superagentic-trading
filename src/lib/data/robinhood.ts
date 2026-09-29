import type { Candle, ProviderCapabilities, Timeframe, TokenMarket } from "../types";
import { TIMEFRAME_SECONDS } from "../types";
import type { MarketDataProvider } from "./provider";
import { getStockAssets, type StockAsset } from "./assets";
import { discoverPools, readPoolStates, type PoolState } from "./pools";
import { getFeeds, getLatestQuotes, getRoundHistory, type FeedInfo, type PricePoint } from "./chainlink";
import { cache } from "../cache";
import { candlesFromPricePoints } from "./candles";

/**
 * Live Robinhood Chain mainnet data, assembled from three public sources:
 *
 * - Robinhood's asset API for the Stock Token universe
 * - Uniswap v3 pools, read over RPC, for tradeable spot prices and TVL
 * - Chainlink feeds for reference prices and for price history
 *
 * Volume and transaction counts are deliberately absent. Deriving them needs
 * Swap logs across a day of ~100ms blocks, which a public RPC cannot serve, so
 * the provider reports them as unavailable instead of estimating.
 */

const MARKETS_TTL = 30 * 1000;
const CANDLE_TTL = 3 * 60 * 1000;
/** Oracle rounds to pull for the market list, enough to span >24h of updates. */
const RECENT_ROUNDS = 28;
/** Oracle rounds to pull for a full chart. */
const HISTORY_ROUNDS = 900;
/**
 * How far a pool price may sit from its Chainlink reference before we stop
 * believing the pool. Generous, because a 24/7 venue really does drift from a
 * closed equity market, but tight enough to reject unseeded pools.
 */
const MAX_ORACLE_DEVIATION = 0.75;

export class RobinhoodChainProvider implements MarketDataProvider {
  readonly source = "robinhood-chain" as const;
  /**
   * Chainlink publishes on price deviation with a 24h heartbeat, which works
   * out to roughly 15 rounds a day. Anything finer than 4h would be mostly
   * interpolation, so it is not offered.
   */
  readonly supportedTimeframes: readonly Timeframe[] = ["4h", "1d"];
  readonly capabilities: ProviderCapabilities = {
    volume24h: false,
    txCount24h: false,
    tokenAge: false,
    priceHistory: true,
    liveTrading: true,
  };

  private async build(): Promise<TokenMarket[]> {
    const [assets, feeds] = await Promise.all([getStockAssets(), getFeeds()]);

    // One batched read covers the latest oracle price for every ticker we hold.
    const assetBySymbol = new Map(assets.map((a) => [a.symbol, a]));
    const relevantFeeds = [...feeds.values()].filter((f) => assetBySymbol.has(f.symbol));
    const quotes = await getLatestQuotes(relevantFeeds);

    const pools = await discoverPools(assets);
    const refs = [...pools.values()].flat();
    const states = await readPoolStates(refs);

    // Every quote asset needs a USD rate before pool prices mean anything.
    const nativeUsd = await this.nativeUsd();
    const usdPerQuote = (kind: "stable" | "native") => (kind === "stable" ? 1 : nativeUsd);
    const symbolByAddress = new Map(assets.map((a) => [a.address, a.symbol]));

    const bestByToken = new Map<string, { state: PoolState; tvlUsd: number; priceUsd: number }>();
    for (const state of states) {
      const rate = usdPerQuote(state.quote.kind);
      const priceUsd = state.priceInQuote * rate;
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

      // Where an oracle exists, treat it as the sanity bound. A pool quoting a
      // price wildly away from the reference is broken or unseeded, not a market.
      const symbol = symbolByAddress.get(state.token);
      const oracle = symbol ? quotes.get(symbol) : undefined;
      if (oracle && oracle.price > 0) {
        const ratio = priceUsd / oracle.price;
        if (ratio > 1 + MAX_ORACLE_DEVIATION || ratio < 1 / (1 + MAX_ORACLE_DEVIATION)) continue;
      }

      const tvlUsd = state.quoteBalance * rate + state.tokenBalance * priceUsd;
      const current = bestByToken.get(state.token);
      if (!current || tvlUsd > current.tvlUsd) bestByToken.set(state.token, { state, tvlUsd, priceUsd });
    }

    const changes = await this.recentChanges(relevantFeeds);

    const markets: TokenMarket[] = [];
    for (const asset of assets) {
      const best = bestByToken.get(asset.address);
      if (!best) continue;
      const quote = quotes.get(asset.symbol);
      const change = changes.get(asset.symbol);
      const oraclePriceUsd = quote?.price ?? null;
      markets.push({
        token: {
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          decimals: asset.decimals,
          logoUrl: asset.logoUrl,
          multiplier: asset.multiplier,
          isin: asset.isin,
        },
        poolAddress: best.state.pool,
        feeTier: best.state.feeTier,
        quoteSymbol: best.state.quote.symbol,
        priceUsd: best.priceUsd,
        oraclePriceUsd,
        oracleBasisPct:
          oraclePriceUsd && oraclePriceUsd > 0 ? ((best.priceUsd - oraclePriceUsd) / oraclePriceUsd) * 100 : null,
        oracleUpdatedAt: quote?.updatedAt ?? null,
        oracleStale: quote?.stale ?? false,
        liquidityUsd: best.tvlUsd,
        volume24hUsd: null,
        priceChange1hPct: change?.h1 ?? null,
        priceChange24hPct: change?.h24 ?? null,
        txCount24h: null,
        createdAt: null,
        tradableNow: asset.tradableNow,
        hasPriceHistory: feeds.has(asset.symbol),
      });
    }

    markets.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    return markets;
  }

  /**
   * Derive 1h and 24h moves from a short window of oracle rounds. Rounds are
   * irregular, so we take the newest round at or before each cutoff.
   */
  private async recentChanges(feeds: FeedInfo[]): Promise<Map<string, { h1: number | null; h24: number | null }>> {
    const out = new Map<string, { h1: number | null; h24: number | null }>();
    const settled = await Promise.allSettled(
      feeds.map(async (feed) => ({
        symbol: feed.symbol,
        points: await cache.get(`rounds:${feed.proxyAddress}:${RECENT_ROUNDS}`, MARKETS_TTL, () =>
          getRoundHistory(feed, RECENT_ROUNDS),
        ),
      })),
    );
    const now = Math.floor(Date.now() / 1000);
    for (const r of settled) {
      if (r.status !== "fulfilled" || r.value.points.length < 2) continue;
      const points = r.value.points;
      const latest = points[points.length - 1];
      const priceAt = (cutoff: number): number | null => {
        for (let i = points.length - 1; i >= 0; i--) if (points[i].time <= cutoff) return points[i].price;
        return null;
      };
      const pct = (then: number | null) =>
        then && then > 0 ? ((latest.price - then) / then) * 100 : null;
      out.set(r.value.symbol, { h1: pct(priceAt(now - 3600)), h24: pct(priceAt(now - 86_400)) });
    }
    return out;
  }

  async nativeUsd(): Promise<number> {
    return cache.get("native:usd", MARKETS_TTL, async () => {
      const feeds = await getFeeds();
      const eth = feeds.get("ETH");
      if (!eth) throw new Error("No ETH/USD Chainlink feed found for Robinhood Chain");
      const quotes = await getLatestQuotes([eth]);
      const quote = quotes.get("ETH");
      if (!quote) throw new Error("ETH/USD feed returned no price");
      return quote.price;
    });
  }

  async listTokens(limit = 200): Promise<TokenMarket[]> {
    const markets = await cache.get("rh:markets", MARKETS_TTL, () => this.build());
    return markets.slice(0, limit);
  }

  async findToken(query: string): Promise<TokenMarket | null> {
    const q = query.trim().toLowerCase();
    const all = await this.listTokens(500);
    return (
      all.find((t) => t.token.address.toLowerCase() === q) ??
      all.find((t) => t.token.symbol.toLowerCase() === q) ??
      all.find((t) => t.token.name.toLowerCase() === q) ??
      all.find((t) => t.token.name.toLowerCase().includes(q)) ??
      null
    );
  }

  async getCandles(token: TokenMarket, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    if (!this.supportedTimeframes.includes(timeframe)) {
      throw new Error(
        `Robinhood Chain oracle history supports ${this.supportedTimeframes.join(" and ")} only; ${timeframe} would be interpolation`,
      );
    }
    const feeds = await getFeeds();
    const feed = feeds.get(token.token.symbol);
    if (!feed) {
      throw new Error(`No Chainlink price feed exists for ${token.token.symbol}, so it has no price history on chain`);
    }
    const points = await cache.get(`rounds:${feed.proxyAddress}:${HISTORY_ROUNDS}`, CANDLE_TTL, () =>
      getRoundHistory(feed, HISTORY_ROUNDS),
    );
    return this.toCandles(points, timeframe, limit);
  }

  private toCandles(points: PricePoint[], timeframe: Timeframe, limit: number): Candle[] {
    return candlesFromPricePoints(points, TIMEFRAME_SECONDS[timeframe]).slice(-limit);
  }
}
