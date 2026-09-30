import { parseAbi } from "viem";
import { getPublicClient } from "../chain/client";

export interface TokenMeta {
  symbol: string;
  name: string;
  decimals: number;
}

const metaAbi = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** ERC-20 metadata never changes, so it is kept for the life of the process. */
const known = new Map<string, TokenMeta | null>();
const CHUNK = 600;

export async function getTokenMeta(addresses: readonly `0x${string}`[]): Promise<Map<string, TokenMeta>> {
  const missing = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => !known.has(a)) as `0x${string}`[];
  const client = getPublicClient();
  for (let i = 0; i < missing.length; i += CHUNK / 3) {
    const slice = missing.slice(i, i + CHUNK / 3);
    const results = await client.multicall({
      contracts: slice.flatMap((address) => [
        { address, abi: metaAbi, functionName: "symbol" as const },
        { address, abi: metaAbi, functionName: "name" as const },
        { address, abi: metaAbi, functionName: "decimals" as const },
      ]),
      allowFailure: true,
    });
    slice.forEach((address, j) => {
      const [symbol, name, decimals] = results.slice(j * 3, j * 3 + 3);
      if (symbol.status !== "success" || name.status !== "success" || decimals.status !== "success") {
        known.set(address, null);
        return;
      }
      known.set(address, {
        symbol: String(symbol.result).slice(0, 24),
        name: String(name.result).slice(0, 64),
        decimals: Number(decimals.result),
      });
    });
  }
  const out = new Map<string, TokenMeta>();
  for (const a of addresses) {
    const meta = known.get(a.toLowerCase());
    if (meta) out.set(a.toLowerCase(), meta);
  }
  return out;
}
