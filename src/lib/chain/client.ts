import { createPublicClient, defineChain, fallback, http, type HttpTransportConfig, type PublicClient, type Transport } from "viem";
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

/** The primary RPC, then each configured backup in order. */
function transportFor(urls: string[], opts: HttpTransportConfig): Transport {
  const unique = [...new Set(urls)];
  if (unique.length === 1) return http(unique[0], opts);
  return fallback(
    unique.map((u) => http(u, opts)),
    { retryCount: 1 },
  );
}

let client: PublicClient | undefined;

export function getPublicClient(): PublicClient {
  if (!client) {
    const cfg = getConfig();
    client = createPublicClient({
      chain: getChain(),
      transport: transportFor([cfg.RH_RPC_URL, ...cfg.RH_RPC_FALLBACK_URLS], {
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
    const cfg = getConfig();
    const primary = cfg.RH_LOGS_RPC_URL ?? cfg.RH_RPC_URL;
    logsClient = createPublicClient({
      chain: getChain(),
      transport: transportFor([primary, cfg.RH_RPC_URL, ...cfg.RH_RPC_FALLBACK_URLS], {
        timeout: 45_000,
        retryCount: 2,
        retryDelay: 600,
      }),
    }) as PublicClient;
  }
  return logsClient;
}

/** Test helper */
export function resetClient(): void {
  client = undefined;
  logsClient = undefined;
}
