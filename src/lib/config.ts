import { z } from "zod";
import { ROBINHOOD_MAINNET, UNISWAP_V3, WRAPPED_NATIVE } from "./chain/constants";

const addr = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as `0x${string}`);

const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  OPENAI_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  /** Defaults target Robinhood Chain mainnet. */
  RH_CHAIN_ID: z.coerce.number().int().positive().default(ROBINHOOD_MAINNET.chainId),
  RH_CHAIN_NAME: z.string().default(ROBINHOOD_MAINNET.name),
  /** Server-side RPC. May carry a provider API key, so it is never sent to the browser. */
  RH_RPC_URL: z.string().url().default(ROBINHOOD_MAINNET.rpcUrl),
  /** Comma-separated backup RPCs tried in order when the primary fails or rate-limits. */
  RH_RPC_FALLBACK_URLS: z.preprocess(
    emptyToUndef,
    z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
      .pipe(z.array(z.string().url())),
  ),
  /** Optional separate endpoint for heavy eth_getLogs reads. */
  RH_LOGS_RPC_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  /** RPC handed to browser wallets when adding the chain. Keep this keyless. */
  RH_PUBLIC_RPC_URL: z.string().url().default(ROBINHOOD_MAINNET.rpcUrl),
  RH_EXPLORER_URL: z.string().url().default(ROBINHOOD_MAINNET.explorerUrl),
  RH_NATIVE_SYMBOL: z.string().default(ROBINHOOD_MAINNET.nativeSymbol),

  /** "chain" reads mainnet directly; the others are for development. */
  SAT_DATA_SOURCE: z.enum(["chain", "subgraph", "synthetic"]).default("chain"),
  RH_SUBGRAPH_URL: z.preprocess(emptyToUndef, z.string().url().optional()),

  RH_SWAP_ROUTER: z.preprocess(emptyToUndef, addr.optional()).default(UNISWAP_V3.swapRouter02),
  RH_WRAPPED_NATIVE: z.preprocess(emptyToUndef, addr.optional()).default(WRAPPED_NATIVE),

  /** Trading is off unless explicitly enabled, even though the router is known. */
  SAT_ENABLE_TRADING: z
    .preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).default("false"))
    .transform((v) => v === "true"),
  SAT_MAX_TRADE_NATIVE: z.coerce.number().positive().default(0.05),
  SAT_MAX_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(1000).default(100),
  SAT_MIN_LIQUIDITY_USD: z.coerce.number().nonnegative().default(10_000),
  /** Quoted loss versus spot, fees and launch tax included, above which a trade is refused. */
  SAT_MAX_PRICE_IMPACT_PCT: z.coerce.number().positive().max(100).default(15),

  /** The SAT token. Holding it unlocks tiers; price is read from its Uniswap v4 pool. */
  SAT_TOKEN_ADDRESS: z.preprocess(emptyToUndef, addr.optional()).default("0xbe3f794bfb99399a4ea9cd5acf08529eea6e718a"),
  /** USD value of SAT a wallet must hold for each tier. */
  SAT_TIER_HOLDER_USD: z.coerce.number().nonnegative().default(50),
  SAT_TIER_WHALE_USD: z.coerce.number().nonnegative().default(500),
  /** Fee on Uniswap trades placed through SAT, taken by the router in the same transaction. Max 100 (1%). */
  SAT_FEE_BPS: z.coerce.number().int().min(0).max(100).default(50),
  SAT_FEE_RECIPIENT: z.preprocess(emptyToUndef, addr.optional()).default("0x10Acd70eeEb62dD762F1518D8aC687C77C484a76"),
});

export type SatConfig = z.infer<typeof EnvSchema>;

let cached: SatConfig | undefined;

export function getConfig(): SatConfig {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** Test helper */
export function resetConfigCache(): void {
  cached = undefined;
}

/** The SAT fee in basis points, or 0 when no fee wallet is set. */
export function tradeFeeBps(cfg = getConfig()): number {
  return cfg.SAT_FEE_RECIPIENT ? cfg.SAT_FEE_BPS : 0;
}

export function executionEnabled(cfg = getConfig()): boolean {
  return cfg.SAT_ENABLE_TRADING && Boolean(cfg.RH_SWAP_ROUTER && cfg.RH_WRAPPED_NATIVE);
}
