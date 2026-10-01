import type { PublicClient } from "viem";

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Contracts = Parameters<PublicClient["multicall"]>[0]["contracts"];
type Result = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

/**
 * Multicall that tells a rate-limited node apart from calls that really fail.
 * With allowFailure, viem reports a failed RPC request as every call in the
 * batch failing; cached as-is, that reads as "nothing exists". A batch where
 * every call failed is retried with backoff and then thrown, so callers never
 * cache an outage as an answer.
 */
export async function multicallStrict(client: PublicClient, contracts: Contracts): Promise<Result[]> {
  if (contracts.length === 0) return [];
  for (let attempt = 0; ; attempt++) {
    const results = (await client.multicall({ contracts, allowFailure: true })) as Result[];
    if (!isOutage(results)) return results;
    if (attempt >= RETRIES) throw new Error("RPC unavailable: a whole multicall batch failed");
    await sleep(500 * 2 ** attempt + Math.random() * 300);
  }
}

/** Every call failed, and not because the contracts reverted. */
function isOutage(results: Result[]): boolean {
  if (results.some((r) => r.status === "success")) return false;
  return results.some((r) => r.status === "failure" && !isRevert(r.error));
}

function isRevert(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 6; e = (e as { cause?: unknown }).cause, i++) {
    const { name, shortMessage, message } = e as { name?: string; shortMessage?: string; message?: string };
    if (/revert/i.test(`${name ?? ""} ${shortMessage ?? ""} ${message ?? ""}`)) return true;
  }
  return false;
}
