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
        // + depreciation + revenue + license-usage) for the default ranges, so the
        // first /api/dashboard hit is fully cache-served. Run SEQUENTIALLY — firing
        // them concurrently floods BC with ~60 parallel calls, triggers rate-limit
        // throttling, and the degraded (partial) results are deliberately NOT cached,
        // which defeats the warm-up. The rolling "last 12 months" range is the
        // default the Overview opens on, so warm it FIRST; include a ±1-day boundary
        // variant since the client computes the range in local time vs this UTC one.
        const from12b = new Date(from12); from12b.setDate(from12b.getDate() - 1);
        const now1 = new Date(now); now1.setDate(now1.getDate() + 1);
        const ranges: [string, string][] = [
          [iso(from12), iso(now)],
          [iso(from12b), iso(now)],
          [iso(from12), iso(now1)],
          [`${yr}-01-01`, `${yr}-12-31`],
        ];
        for (const [f, t] of ranges) {
          await ds.getDashboardKPIs("all", f, t);
        }
        console.log("[startup] IT Finance cache warmed");
      } catch (err) {
        console.warn("[startup] cache warm failed:", err);
      }
    })();
  }, 200);
}
