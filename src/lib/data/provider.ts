import type { Candle, DataSource, ProviderCapabilities, Timeframe, TokenMarket } from "../types";
import { getConfig } from "../config";
import { RobinhoodChainProvider } from "./robinhood";
import { SubgraphProvider } from "./subgraph";
import { SyntheticProvider } from "./synthetic";

/** Pluggable market-data source for Robinhood Chain tokens. */
export interface MarketDataProvider {
  readonly source: DataSource;
  readonly supportedTimeframes: readonly Timeframe[];
  readonly capabilities: ProviderCapabilities;
  /** Tokens with a tradeable pool, deepest liquidity first. */
  listTokens(limit?: number): Promise<TokenMarket[]>;
  /** Resolve by symbol (case-insensitive), name or token address. */
  findToken(query: string): Promise<TokenMarket | null>;
  /** Ascending OHLCV candles, most recent last. */
  getCandles(token: TokenMarket, timeframe: Timeframe, limit?: number): Promise<Candle[]>;
  /** Native asset price in USD (used for trade sizing). */
  nativeUsd(): Promise<number>;
}

let provider: MarketDataProvider | undefined;

export function getProvider(): MarketDataProvider {
  if (!provider) {
    const cfg = getConfig();
    if (cfg.SAT_DATA_SOURCE === "synthetic") provider = new SyntheticProvider();
    else if (cfg.SAT_DATA_SOURCE === "subgraph") {
      if (!cfg.RH_SUBGRAPH_URL) throw new Error("SAT_DATA_SOURCE=subgraph requires RH_SUBGRAPH_URL");
      provider = new SubgraphProvider(cfg.RH_SUBGRAPH_URL);
    } else provider = new RobinhoodChainProvider();
  }
  return provider;
}

/** Test helper */
export function setProvider(p: MarketDataProvider | undefined): void {
  provider = p;
}
