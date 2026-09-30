import type { Candle, ProviderCapabilities, Timeframe, TokenMarket } from "../types";
import { TIMEFRAME_SECONDS } from "../types";
import type { MarketDataProvider } from "./provider";
import { getStockAssets, type StockAsset } from "./assets";
import { discoverPools, readPoolStates, type PoolState } from "./pools";
import { getFeeds, getLatestQuotes, getRoundHistories, getRoundHistory, type FeedInfo, type FeedQuote, type PricePoint } from "./chainlink";
import { cache } from "../cache";
import { candlesFromPricePoints } from "./candles";
import { getPoolVolumes24h } from "../chain/poolVolume";
import { listPonsMarkets, type QuoteBook } from "./pons";
import { ponsCandles, ponsMarket, PONS_TIMEFRAMES } from "./ponsToken";

/**
 * Live Robinhood Chain mainnet data, assembled from three public sources:
 *
 * - Robinhood's asset API for the Stock Token universe
 * - Uniswap v3 pools, read over RPC, for tradeable spot prices and TVL
 * - Chainlink feeds for reference prices and for price history
 *
 * 24h swap volume is read from Uniswap v3 Swap logs in batched eth_getLogs
 * calls (~18 slices for the full stock universe) and cached for several minutes.
 */

const MARKETS_TTL = 90 * 1000;
const LIST_TTL = 20 * 1000;
const CANDLE_TTL = 3 * 60 * 1000;
/** 24h moves change slowly; don't re-walk oracle rounds on every list refresh. */
const CHANGE_TTL = 3 * 60 * 1000;
const PONS_TTL = 45 * 1000;
/** How long the market list waits on a cold 24h volume scan before listing without it. */
const VOLUME_WAIT_MS = 8 * 1000;
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
    volume24h: true,
    txCount24h: true,
    tokenAge: false,
    priceHistory: true,
    liveTrading: true,
  };

  /**
   * Stock markets without 24h volume: every pool price, oracle price and
   * change. A few multicalls when warm, so live feeds can lean on it.
   */
  async baseStocks(): Promise<TokenMarket[]> {
    return cache.get("rh:stocks", MARKETS_TTL, () => this.build(), { swr: true });
  }

  /** USD price of every asset a Pons curve can be quoted in. */
  async quoteBook(): Promise<QuoteBook> {
    const [stocks, ethUsd] = await Promise.all([this.baseStocks(), this.nativeUsd().catch(() => 0)]);
    const book: QuoteBook = { ethUsd, byAddress: new Map() };
    for (const m of stocks) {
      book.byAddress.set(m.token.address.toLowerCase(), {
        usd: m.priceUsd,
        decimals: m.token.decimals,
        symbol: m.token.symbol,
      });
    }
    return book;
  }

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

    const changes = await this.recentChanges(relevantFeeds, quotes);

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
        volume24hUsd: 0,
        priceChange1hPct: change?.h1 ?? null,
        priceChange24hPct: change?.h24 ?? null,
        txCount24h: 0,
        createdAt: null,
        tradableNow: asset.tradableNow,
        hasPriceHistory: feeds.has(asset.symbol),
        venue: "uniswap-v3",
      });
    }

    markets.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    return markets;
  }

  /** Base markets plus 24h volume, highest volume first. */
  private async stocksWithVolume(): Promise<TokenMarket[]> {
    const markets = (await this.baseStocks()).map((m) => ({ ...m }));
    const specs = markets.map((m) => ({
      pool: m.poolAddress,
      token: m.token.address,
      decimals: m.token.decimals,
      priceUsd: m.priceUsd,
    }));
    // A cold 24h scan takes a minute or more. Don't hold the page for it: the
    // scan keeps running and the next refresh picks the numbers up.
    const volumes = await Promise.race([
      getPoolVolumes24h(specs).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), VOLUME_WAIT_MS)),
    ]);
    for (const m of markets) {
      const v = volumes?.get(m.poolAddress.toLowerCase());
      m.volume24hUsd = volumes ? (v?.volumeUsd ?? 0) : null;
      m.txCount24h = volumes ? (v?.swapCount ?? 0) : null;
    }
    markets.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0) || b.liquidityUsd - a.liquidityUsd);
    return markets;
  }

  /**
   * Derive 1h and 24h moves from a short window of oracle rounds. Rounds are
   * irregular, so we take the newest round at or before each cutoff.
   */
  private async recentChanges(
    feeds: FeedInfo[],
    quotes: Map<string, FeedQuote>,
  ): Promise<Map<string, { h1: number | null; h24: number | null }>> {
    const specs = feeds.flatMap((feed) => {
      const latest = quotes.get(feed.symbol);
      return latest ? [{ symbol: feed.symbol, feed, latest }] : [];
    });
    const key = `rounds:batch:${specs.map((s) => s.feed.proxyAddress).join(",")}:${RECENT_ROUNDS}`;
    const histories = await cache.get(key, CHANGE_TTL, () => getRoundHistories(specs, RECENT_ROUNDS));

    const now = Math.floor(Date.now() / 1000);
    const out = new Map<string, { h1: number | null; h24: number | null }>();
    for (const spec of specs) {
      const points = histories.get(spec.symbol) ?? [];
      if (points.length < 2) continue;
      const latest = points[points.length - 1];
      const priceAt = (cutoff: number): number | null => {
        for (let i = points.length - 1; i >= 0; i--) if (points[i].time <= cutoff) return points[i].price;
        return null;
      };
      const pct = (then: number | null) => (then && then > 0 ? ((latest.price - then) / then) * 100 : null);
      out.set(spec.symbol, { h1: pct(priceAt(now - 3600)), h24: pct(priceAt(now - 86_400)) });
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

  private async withPons(stocks: TokenMarket[]): Promise<TokenMarket[]> {
    const pons = await cache
      .get("rh:pons", PONS_TTL, async () => listPonsMarkets(await this.quoteBook()), { swr: true })
      .catch((err: unknown) => {
        console.error("Pons market load failed:", err instanceof Error ? err.message : err);
        return [] as TokenMarket[];
      });
    // Robinhood stock tokens first (by 24h volume), then launchpad curves.
    return [...stocks, ...pons];
  }

  async listTokens(limit = 200): Promise<TokenMarket[]> {
    // Every input below is cached on its own, so re-assembling the list is cheap.
    const markets = await cache.get(
      "rh:markets",
      LIST_TTL,
      async () => this.withPons(await this.stocksWithVolume()),
      { swr: true },
    );
    return markets.slice(0, limit);
  }

  async findToken(query: string): Promise<TokenMarket | null> {
    const q = query.trim().toLowerCase();
    const all = await this.listTokens(500);
    const byAddress = all.find((t) => t.token.address.toLowerCase() === q);
    if (byAddress) return byAddress;
    // Any live Pons curve resolves by address, even outside the listed top curves.
    if (/^0x[0-9a-f]{40}$/.test(q)) {
      const pons = await ponsMarket(q, await this.quoteBook()).catch(() => null);
      if (pons) return pons.market;
    }
    // A launch can reuse a stock ticker. Prefer the Uniswap market for a bare symbol.
    const bySymbol = all.filter((t) => t.token.symbol.toLowerCase() === q);
    if (bySymbol.length > 0) return bySymbol.find((t) => t.venue !== "pons") ?? bySymbol[0];
    return (
      all.find((t) => t.token.name.toLowerCase() === q) ??
      all.find((t) => t.token.name.toLowerCase().includes(q)) ??
      null
    );
  }

  /** Pons curves chart from their own trades, so they support finer timeframes than oracle history. */
  timeframesFor(token: TokenMarket): readonly Timeframe[] {
    return token.venue === "pons" ? PONS_TIMEFRAMES : this.supportedTimeframes;
  }

  async getCandles(token: TokenMarket, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    if (!this.timeframesFor(token).includes(timeframe)) {
      throw new Error(`${token.token.symbol} supports ${this.timeframesFor(token).join(", ")} candles only`);
    }
    if (token.venue === "pons") return ponsCandles(token, await this.quoteBook(), timeframe, limit);
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
