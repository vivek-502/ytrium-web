/**
 * TTL + LRU cache. In-memory only: expiring media URLs are never persisted
 * to disk and are dropped as soon as their TTL elapses.
 */
interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private map = new Map<string, Entry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number = 500,
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU recency.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Returns a value only if the remaining TTL is at least `minRemainingMs`. */
  getWithMinTtl(key: string, minRemainingMs: number): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    const remaining = entry.expiresAt - Date.now();
    if (remaining < minRemainingMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.ttlMs): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Drop all expired entries (housekeeping). */
  prune(): void {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expiresAt <= now) this.map.delete(k);
  }
}

/** Cache a promise-producing computation so concurrent callers share one call. */
export async function memoize<T>(
  cache: TtlCache<T>,
  key: string,
  producer: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  cache.set(key, value, ttlMs);
  return value;
}
