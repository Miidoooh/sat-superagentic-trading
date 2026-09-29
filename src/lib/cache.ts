interface Entry<T> {
  value: T;
  expires: number;
}

/**
 * Process-local TTL cache with single-flight de-duplication. The public
 * Robinhood Chain RPC rate-limits aggressively, so every upstream read goes
 * through here and concurrent callers share one in-flight request.
 */
export class TtlCache {
  private entries = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = load()
      .then((value) => {
        this.entries.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .catch((err) => {
        // On failure, serve stale data rather than breaking the page.
        if (hit) return hit.value as T;
        throw err;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}

export const cache = new TtlCache();
