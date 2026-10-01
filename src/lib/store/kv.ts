/**
 * Tiny key-value store. Uses Upstash Redis over its REST API when
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, so every
 * serverless instance and the background worker share one state. Without them
 * it falls back to process memory, which is fine for a single local server.
 */

type Json = unknown;

export interface KvStore {
  readonly shared: boolean;
  get<T = Json>(key: string): Promise<T | null>;
  set(key: string, value: Json, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

class MemoryKv implements KvStore {
  readonly shared = false;
  private values = new Map<string, { value: string; expires: number }>();
  private sets = new Map<string, Set<string>>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (hit.expires && hit.expires < Date.now()) {
      this.values.delete(key);
      return null;
    }
    return JSON.parse(hit.value) as T;
  }
  async set(key: string, value: Json, ttlMs?: number): Promise<void> {
    this.values.set(key, { value: JSON.stringify(value), expires: ttlMs ? Date.now() + ttlMs : 0 });
  }
  async del(key: string): Promise<void> {
    this.values.delete(key);
  }
  async sadd(key: string, member: string): Promise<void> {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }
  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
}

class UpstashKv implements KvStore {
  readonly shared = true;
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Redis ${args[0]} failed: ${body.error ?? res.status}`);
    return body.result as T;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.cmd<string | null>("GET", key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }
  async set(key: string, value: Json, ttlMs?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlMs) await this.cmd("SET", key, raw, "PX", Math.max(1, Math.round(ttlMs)));
    else await this.cmd("SET", key, raw);
  }
  async del(key: string): Promise<void> {
    await this.cmd("DEL", key);
  }
  async sadd(key: string, member: string): Promise<void> {
    await this.cmd("SADD", key, member);
  }
  async srem(key: string, member: string): Promise<void> {
    await this.cmd("SREM", key, member);
  }
  async smembers(key: string): Promise<string[]> {
    return (await this.cmd<string[]>("SMEMBERS", key)) ?? [];
  }
}

let store: KvStore | undefined;

export function getKv(): KvStore {
  if (!store) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    store = url && token ? new UpstashKv(url.replace(/\/$/, ""), token) : new MemoryKv();
  }
  return store;
}

/** Test helper */
export function setKv(next: KvStore | undefined): void {
  store = next;
}

export { MemoryKv };
