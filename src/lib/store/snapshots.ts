import { getKv } from "./kv";

/**
 * Snapshots the background worker publishes and the web routes read. When the
 * worker is running, a request is served straight from Redis and never touches
 * the RPC. When it is not, the route computes the snapshot itself and shares
 * the result with every other instance for the same freshness window.
 */

interface Stored<T> {
  at: number;
  data: T;
}

export const MARKET_KEY = "market:tokens";
export const MARKET_FRESH_MS = 20 * 1000;

/** Stale snapshots are still served if a fresh read fails, up to this age. */
const KEEP_MS = 10 * 60 * 1000;
const HEARTBEAT_KEY = "worker:heartbeat";
const HEARTBEAT_FRESH_MS = 60 * 1000;

const local = new Map<string, Promise<unknown>>();

export async function readSnapshot<T>(key: string, maxAgeMs: number): Promise<T | null> {
  const hit = await getKv()
    .get<Stored<T>>(`snap:${key}`)
    .catch(() => null);
  return hit && Date.now() - hit.at <= maxAgeMs ? hit.data : null;
}

export async function writeSnapshot<T>(key: string, data: T): Promise<void> {
  await getKv().set(`snap:${key}`, { at: Date.now(), data } satisfies Stored<T>, KEEP_MS);
}

/** Serve a fresh shared snapshot, or compute it once, publish it, and serve that. */
export async function sharedSnapshot<T>(key: string, maxAgeMs: number, compute: () => Promise<T>): Promise<T> {
  const kv = getKv();
  if (!kv.shared) return compute();

  const hit = await kv.get<Stored<T>>(`snap:${key}`).catch(() => null);
  if (hit && Date.now() - hit.at <= maxAgeMs) return hit.data;

  const running = local.get(key) as Promise<T> | undefined;
  if (running) return running;
  const job = compute()
    .then(async (data) => {
      await writeSnapshot(key, data).catch(() => undefined);
      return data;
    })
    .catch((err: unknown) => {
      if (hit) return hit.data;
      throw err;
    })
    .finally(() => local.delete(key));
  local.set(key, job);
  return job;
}

export async function beatWorker(): Promise<void> {
  await getKv().set(HEARTBEAT_KEY, Date.now(), HEARTBEAT_FRESH_MS * 2);
}

/** True while a background worker has checked in within the last minute. */
export async function workerAlive(): Promise<boolean> {
  const at = await getKv()
    .get<number>(HEARTBEAT_KEY)
    .catch(() => null);
  return typeof at === "number" && Date.now() - at < HEARTBEAT_FRESH_MS;
}
