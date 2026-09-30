import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { getConfig } from "../config";
import { MULTICALL3, ROBINHOOD_MAINNET } from "./constants";

export function getChain() {
  const cfg = getConfig();
  return defineChain({
    id: cfg.RH_CHAIN_ID,
    name: cfg.RH_CHAIN_NAME,
    nativeCurrency: { name: cfg.RH_NATIVE_SYMBOL, symbol: cfg.RH_NATIVE_SYMBOL, decimals: 18 },
    rpcUrls: { default: { http: [cfg.RH_RPC_URL] } },
    blockExplorers: { default: { name: "Explorer", url: cfg.RH_EXPLORER_URL } },
    // Confirmed deployed at the canonical address on Robinhood Chain mainnet.
    contracts:
      cfg.RH_CHAIN_ID === ROBINHOOD_MAINNET.chainId
        ? { multicall3: { address: MULTICALL3 } }
        : undefined,
  });
}

let client: PublicClient | undefined;

export function getPublicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: getChain(),
      transport: http(getConfig().RH_RPC_URL, {
        timeout: 20_000,
        // The public endpoint returns 429 above roughly 50 calls per request.
        batch: { batchSize: 40, wait: 20 },
        retryCount: 4,
        retryDelay: 400,
      }),
      // Multicall3 keeps large reads inside one eth_call instead of hundreds.
      batch: { multicall: { batchSize: 8192, wait: 20 } },
    }) as PublicClient;
  }
  return client;
}

let logsClient: PublicClient | undefined;

/**
 * Client for large eth_getLogs reads. A busy range returns ~10k logs (several
 * MB), so JSON-RPC batching would pack many of them into one response that
 * outlives the timeout. Each call gets its own request and more time.
 */
export function getLogsClient(): PublicClient {
  if (!logsClient) {
    logsClient = createPublicClient({
      chain: getChain(),
      transport: http(getConfig().RH_RPC_URL, { timeout: 45_000, retryCount: 2, retryDelay: 600 }),
    }) as PublicClient;
  }
  return logsClient;
}

/** Test helper */
export function resetClient(): void {
  client = undefined;
  logsClient = undefined;
}
