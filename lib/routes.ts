// Single source of truth for route titles + descriptions.
// Used by the sticky header and the PageHeader masthead so they never drift.

export interface RouteMeta {
  title: string;
  description?: string;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  "/": { title: "Overview", description: "IT spend and cost of IT across all entities" },
  "/cfo": { title: "CFO Cockpit", description: "Group P&L, cash and working-capital position" },
  "/invoices": { title: "Invoices", description: "IT invoices, aging and payment status" },
  "/licenses": { title: "Software Licenses", description: "Microsoft 365 seats and utilization" },
  "/savings": { title: "Optimization", description: "Savings opportunities and unused spend" },
  "/budget": { title: "Budget", description: "Budget vs actual and forecast" },
  "/vendors": { title: "Vendors", description: "IT spend by vendor and cost driver" },
  "/devices": { title: "Devices", description: "Managed device inventory and compliance" },
  "/personnel": { title: "Personnel", description: "IT team cost and allocation" },
  "/developers": { title: "Developers", description: "Engineering activity and delivery cost" },
  "/import": { title: "Import", description: "Bring in data from files and sources" },
  "/connectors": { title: "Connectors", description: "Live data source connections" },
  "/peppol": { title: "Peppol", description: "E-invoicing via the Peppol network" },
  "/insights": { title: "Insights", description: "AI analysis of your IT finances" },
  "/contracts": { title: "Contracts", description: "Vendor contracts and renewals" },
  "/settings": { title: "Settings", description: "Configuration and data mapping" },
};

export function getRouteMeta(pathname: string): RouteMeta {
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  const match = Object.keys(ROUTE_META)
    .filter((k) => k !== "/")
    .sort((a, b) => b.length - a.length)
    .find((k) => pathname.startsWith(k));
  return match ? ROUTE_META[match] : { title: "IT Finance" };
}
