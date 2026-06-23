import { OverviewClient } from "@/components/dashboard/overview-client";

// Render dynamically so the page HTML is served with no-store and is never
// cached by the browser or the CDN. This guarantees a fresh deploy always
// reaches users instead of pinning a stale client bundle.
export const dynamic = "force-dynamic";

export default function OverviewPage() {
  return <OverviewClient />;
}
