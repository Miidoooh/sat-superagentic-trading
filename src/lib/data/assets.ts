import { getAddress, isAddress } from "viem";
import { RH_ASSETS_API } from "../chain/constants";
import { cache } from "../cache";
import { getConfig } from "../config";

/** A Stock Token as published by Robinhood's public asset API. */
export interface StockAsset {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  multiplier: number;
  isin?: string;
  /** True when Robinhood reports the asset tradable in at least one session */
  tradableNow: boolean;
}

interface ApiDeployment {
  contractAddress?: string;
  chainId?: number;
}

interface ApiTradingStatus {
  whole?: string;
  fractional?: string;
}

interface ApiAsset {
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  logoUrl?: string;
  currentMultiplier?: string;
  status?: string;
  isin?: string;
  deployments?: ApiDeployment[];
  tradingCapabilities?: Record<string, ApiTradingStatus>;
}

const TTL = 10 * 60 * 1000;

/** Robinhood's names read "Tesla • Robinhood Token"; keep just the company. */
function cleanName(name: string, symbol: string): string {
  const trimmed = name.split("•")[0].trim();
  return trimmed || symbol;
}

function isTradable(caps: ApiAsset["tradingCapabilities"]): boolean {
  if (!caps) return false;
  return Object.values(caps).some(
    (s) => s.whole === "TRADING_STATUS_TRADABLE" || s.fractional === "TRADING_STATUS_TRADABLE",
  );
}

export async function getStockAssets(): Promise<StockAsset[]> {
  return cache.get("rh:assets", TTL, async () => {
    const chainId = getConfig().RH_CHAIN_ID;
    const res = await fetch(RH_ASSETS_API, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Robinhood asset API HTTP ${res.status}`);
    const body = (await res.json()) as { assets?: ApiAsset[] };
    const assets: StockAsset[] = [];
    for (const a of body.assets ?? []) {
      if (a.status && a.status !== "ASSET_STATUS_ACTIVE") continue;
      const deployment = a.deployments?.find((d) => d.chainId === chainId);
      const address = deployment?.contractAddress;
      if (!address || !isAddress(address) || !a.tokenSymbol) continue;
      const multiplier = Number(a.currentMultiplier);
      assets.push({
        address: getAddress(address),
        symbol: a.tokenSymbol.toUpperCase(),
        name: cleanName(a.tokenName ?? a.tokenSymbol, a.tokenSymbol),
        decimals: a.tokenDecimals ?? 18,
        logoUrl: a.logoUrl,
        multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
        isin: a.isin,
        tradableNow: isTradable(a.tradingCapabilities),
      });
    }
    if (assets.length === 0) throw new Error(`Robinhood asset API returned no active tokens for chain ${chainId}`);
    return assets;
  });
}
