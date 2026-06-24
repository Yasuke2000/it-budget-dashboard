// Single shared cache across ALL server bundles. Next.js can bundle a server
// component (e.g. the /licenses page) separately from a route handler (e.g.
// /api/settings), each getting its own copy of a module-level `const`. That split
// meant clearCache() from a settings save only cleared the route's copy, so pages
// kept serving stale data (e.g. licenses showing "Free" after prices were set).
// Pinning the Map on globalThis guarantees one instance process-wide.
const globalForCache = globalThis as unknown as {
  __itFinanceCache?: Map<string, { data: unknown; expiry: number }>;
};
const cache =
  globalForCache.__itFinanceCache ??
  (globalForCache.__itFinanceCache = new Map<string, { data: unknown; expiry: number }>());

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
