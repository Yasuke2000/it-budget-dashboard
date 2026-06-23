// Warms the in-memory cache on server startup so the first user hit to the
// Overview is served from warm cache instead of paying cold BC/Graph latency
// (the main cause of a slow/stuck "Loading dashboard data…" right after a pod
// restart). Fire-and-forget: never blocks server readiness.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Only live mode has remote data worth pre-fetching.
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false") return;

  setTimeout(() => {
    void (async () => {
      try {
        const ds = await import("@/lib/data-source");
        const now = new Date();
        const yr = now.getFullYear();
        const from12 = new Date(now);
        from12.setMonth(from12.getMonth() - 12);
        const iso = (d: Date) => d.toISOString().split("T")[0];

        await ds.getCompanies();
        // Warm the two ranges the dashboard uses by default (YTD + last 12 months)
        // plus the Graph-backed getters (which negative-cache their fallback).
        await Promise.allSettled([
          ds.getInvoices("all", `${yr}-01-01`, `${yr}-12-31`),
          ds.getInvoices("all", iso(from12), iso(now)),
          ds.getLicenses(),
          ds.getDevices(),
        ]);
        console.log("[startup] IT Finance cache warmed");
      } catch (err) {
        console.warn("[startup] cache warm failed:", err);
      }
    })();
  }, 200);
}
