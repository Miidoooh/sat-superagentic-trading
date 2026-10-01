import { getAddress, parseAbiItem } from "viem";
import { getLogsClient } from "../chain/client";
import { PONS_V2_FACTORY } from "../chain/constants";
import { blockClock, getLogsAdaptive } from "../chain/logs";
import { listLaunches, PONS_START_BLOCK, type PonsLaunch } from "../data/pons";
import { getPonsProfiles } from "../data/ponsProfile";
import type { RobinhoodChainProvider } from "../data/robinhood";
import { getTokenMeta } from "../data/tokenMeta";

/**
 * Token search across what SAT can see without a database: every listed stock
 * and curve, the newest live launches, and every Pons launch that ever
 * graduated. Tens of thousands of names take minutes to read from a public
 * node, so the index fills in the background, newest first, and every search
 * answers immediately from what is indexed so far. Any 0x address resolves
 * directly regardless (see /api/search).
 */

export type SearchKind = "stock" | "pons" | "graduated";

export interface SearchEntry {
  address: `0x${string}`;
  symbol: string;
  name: string;
  kind: SearchKind;
  /** Rough importance for ranking ties: listed volume or liquidity in USD. */
  weight: number;
}

export interface SearchResult extends SearchEntry {
  logoUrl?: string;
}

const POOL_GRADUATED = parseAbiItem("event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)");
const WINDOW = 2_000_000n;
const RECENT_LAUNCHES = 2_000;
const META_BATCH = 300;
const BATCH_PAUSE_MS = 400;
const REFRESH_MS = 10 * 60 * 1000;

class SearchIndexer {
  private entries = new Map<string, SearchEntry>();
  /** Graduation windows already read in full, by start block. */
  private scanned = new Set<string>();
  private building: Promise<void> | null = null;
  private builtAt = 0;
  done = false;

  get size() {
    return this.entries.size;
  }

  /** Start (or refresh) a background build; never waits for it. */
  ensure(provider: RobinhoodChainProvider) {
    if (this.building || Date.now() - this.builtAt < REFRESH_MS) return;
    this.building = this.build(provider)
      .catch((err) => console.error("search index:", err instanceof Error ? err.message.slice(0, 200) : err))
      .finally(() => {
        this.building = null;
      });
  }

  private add(tokens: `0x${string}`[], kind: SearchKind, meta: Map<string, { symbol: string; name: string }>) {
    for (const t of tokens) {
      const key = t.toLowerCase();
      const existing = this.entries.get(key);
      if (existing && existing.kind !== "pons") continue;
      const m = meta.get(key);
      if (m) this.entries.set(key, { address: t, symbol: m.symbol, name: m.name, kind, weight: existing?.weight ?? (kind === "graduated" ? 1 : 0) });
    }
  }

  private async withMeta(tokens: `0x${string}`[], kind: SearchKind) {
    for (let i = 0; i < tokens.length; i += META_BATCH) {
      const slice = tokens.slice(i, i + META_BATCH);
      this.add(slice, kind, await getTokenMeta(slice));
      // Background work: leave the public node room for the pages people are looking at.
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  private async build(provider: RobinhoodChainProvider) {
    const listed = await provider.listTokens(500);
    for (const m of listed) {
      this.entries.set(m.token.address.toLowerCase(), {
        address: m.token.address,
        symbol: m.token.symbol,
        name: m.token.name,
        kind: m.venue === "pons" ? "pons" : "stock",
        weight: m.volume24hUsd ?? m.liquidityUsd ?? 0,
      });
    }
    const launches = await listLaunches().catch(() => [] as PonsLaunch[]);
    await this.withMeta(launches.slice(0, RECENT_LAUNCHES).map((l) => l.token), "pons");

    // Graduations, newest window first so recent winners are searchable soonest.
    const { head } = await blockClock();
    let complete = true;
    for (let to = head; to > PONS_START_BLOCK; to -= WINDOW) {
      const from = to - WINDOW + 1n > PONS_START_BLOCK ? to - WINDOW + 1n : PONS_START_BLOCK;
      // The newest window always re-reads; older ones never change once read.
      const key = from.toString();
      if (to !== head && this.scanned.has(key)) continue;
      try {
        const logs = await getLogsAdaptive(from, to, (a, b) =>
          getLogsClient().getLogs({ address: getAddress(PONS_V2_FACTORY), event: POOL_GRADUATED, fromBlock: a, toBlock: b }),
        );
        const tokens = [...new Set(logs.flatMap((l) => (l.args.token ? [l.args.token] : [])).reverse())];
        await this.withMeta(tokens, "graduated");
        if (to !== head) this.scanned.add(key);
      } catch {
        complete = false;
      }
    }
    this.done = complete;
    this.builtAt = complete ? Date.now() : Date.now() - REFRESH_MS + 60_000;
  }

  all(): SearchEntry[] {
    return [...this.entries.values()];
  }
}

const indexer = new SearchIndexer();

export function searchIndex(provider: RobinhoodChainProvider): { entries: SearchEntry[]; complete: boolean } {
  indexer.ensure(provider);
  return { entries: indexer.all(), complete: indexer.done };
}

const KIND_RANK: Record<SearchKind, number> = { stock: 3, graduated: 2, pons: 1 };

/** Exact ticker, then ticker prefix, then name prefix, then anywhere in the name. */
export function rankSearch(entries: SearchEntry[], query: string, limit = 20, official?: string): SearchEntry[] {
  const officialKey = official?.toLowerCase();
  const q = query.trim().toLowerCase().replace(/^\$/, "");
  if (!q) return [];
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of entries) {
    const sym = e.symbol.toLowerCase();
    const name = e.name.toLowerCase();
    let score = 0;
    if (sym === q) score = 100;
    else if (sym.startsWith(q)) score = 70;
    else if (name === q) score = 65;
    else if (name.startsWith(q)) score = 50;
    else if (sym.includes(q)) score = 35;
    else if (name.includes(q)) score = 20;
    // The real SAT outranks every copycat that borrows its ticker.
    if (score > 0) scored.push({ e, score: score + KIND_RANK[e.kind] * 3 + (e.address.toLowerCase() === officialKey ? 50 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || b.e.weight - a.e.weight);
  return scored.slice(0, limit).map((s) => s.e);
}

/** Attach logos to the handful of results actually shown. */
export async function withLogos(results: SearchEntry[], listedLogos: Map<string, string | undefined>): Promise<SearchResult[]> {
  const pons = results.filter((r) => r.kind !== "stock").map((r) => r.address);
  const profiles = await getPonsProfiles(pons).catch(() => new Map());
  return results.map((r) => ({ ...r, logoUrl: listedLogos.get(r.address.toLowerCase()) ?? profiles.get(r.address.toLowerCase())?.logoUrl ?? undefined }));
}
