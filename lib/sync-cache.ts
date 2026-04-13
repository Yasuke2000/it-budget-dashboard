const cache = new Map<string, { data: unknown; expiry: number }>();

export function setCache(key: string, data: unknown, ttlMinutes: number): void {
  cache.set(key, { data, expiry: Date.now() + ttlMinutes * 60000 });
}

export function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiry) { cache.delete(key); return null; }
  return entry.data as T;
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; keys: string[] } {
  // Prune expired entries
  for (const [key, entry] of cache.entries()) {
    if (Date.now() > entry.expiry) cache.delete(key);
  }
  return { size: cache.size, keys: [...cache.keys()] };
}
