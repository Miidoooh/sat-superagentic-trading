/**
 * Robinhood Chain mainnet (chainId 4663) addresses.
 *
 * Every address below was verified against the live chain on 2026-09-30:
 * `eth_getCode` returned bytecode, `SwapRouter02.factory()` returned the V3
 * factory below, and `SwapRouter02.WETH9()` returned WRAPPED_NATIVE below.
 *
 * Sources:
 * - docs.robinhood.com/chain/connecting        (chain id, RPC, explorer)
 * - docs.robinhood.com/chain/protocol-contracts (L2 WETH, Permit2, Multicall)
 * - developers.uniswap.org .../v3-robinhood-chain-deployments (Uniswap v3)
 */

export const ROBINHOOD_MAINNET = {
  chainId: 4663,
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  nativeSymbol: "ETH",
} as const;

export const ROBINHOOD_TESTNET = {
  chainId: 46630,
  name: "Robinhood Chain Testnet",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  nativeSymbol: "ETH",
} as const;

/** Canonical Multicall3, confirmed deployed at the standard address on 4663. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const UNISWAP_V3 = {
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

/** L2 WETH on Robinhood Chain. This is what SwapRouter02.WETH9() returns. */
export const WRAPPED_NATIVE = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

/** Global Dollar, the USD stablecoin most Stock Token pools quote against. 6 decimals. */
export const USDG = { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, symbol: "USDG" } as const;

export interface QuoteAsset {
  address: string;
  symbol: string;
  decimals: number;
  /** "stable" is worth $1; "native" needs the ETH/USD rate applied. */
  kind: "stable" | "native";
}

/** Quote assets we look for pools against, in preference order. */
export const QUOTE_ASSETS: QuoteAsset[] = [
  { address: USDG.address, symbol: USDG.symbol, decimals: USDG.decimals, kind: "stable" },
  { address: WRAPPED_NATIVE, symbol: "WETH", decimals: 18, kind: "native" },
];

/** Uniswap v3 fee tiers, in hundredths of a bip. */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;

/** Robinhood's public list of Stock Tokens (tokenised equities and ETFs). */
export const RH_ASSETS_API = "https://api.robinhood.com/rhj/assets";

/** Chainlink's machine-readable feed directory for this chain. */
export const CHAINLINK_DIRECTORY = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
