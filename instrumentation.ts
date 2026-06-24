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
        // Warm the FULL dashboard KPI path (invoices + budget + licenses + devices
        // + depreciation + revenue + license-usage) for the two default ranges, so
        // the first /api/dashboard hit is fully cache-served. getDashboardKPIs
        // populates every sub-getter's cache. Warm yesterday/today boundary variants
        // of the rolling range too, since the client computes it in local time and
        // may land a day off this UTC-based one.
        const from12b = new Date(from12); from12b.setDate(from12b.getDate() - 1);
        await Promise.allSettled([
          ds.getDashboardKPIs("all", `${yr}-01-01`, `${yr}-12-31`),
          ds.getDashboardKPIs("all", iso(from12), iso(now)),
          ds.getDashboardKPIs("all", iso(from12b), iso(now)),
        ]);
        console.log("[startup] IT Finance cache warmed");
      } catch (err) {
        console.warn("[startup] cache warm failed:", err);
      }
    })();
  }, 200);
}
