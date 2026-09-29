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
  RH_RPC_URL: z.string().url().default(ROBINHOOD_MAINNET.rpcUrl),
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

export function executionEnabled(cfg = getConfig()): boolean {
  return cfg.SAT_ENABLE_TRADING && Boolean(cfg.RH_SWAP_ROUTER && cfg.RH_WRAPPED_NATIVE);
}
