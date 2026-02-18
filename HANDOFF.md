# IT Finance Dashboard — Technical Handoff Document

**Project:** IT Finance Dashboard
**Repository:** https://github.com/Yasuke2000/it-budget-dashboard
**Live Demo:** https://it-budget-dashboard.vercel.app
**Author:** David Delporte
**Date:** March 2026
**Status:** MVP complete, demo mode functional, live integrations stubbed and ready

---

## 1. What Was Built

A full-stack IT budget management dashboard for a Belgian multi-entity logistics company (Gheeraert Group: GDI, WHS, GRE, TDR). The dashboard consolidates IT financial data from multiple sources into a single view for IT management decision-making.

### Core Capabilities
- **9 dashboard pages** with real-time KPIs, charts, and data tables
- **Demo mode** with realistic mock data (works out of the box, no API keys needed)
- **7 API integration clients** ready for live data (BC, Graph, Officient, Jira, Dell, Lenovo, Azure Cost Management)
- **CSV import system** for manual data ingestion with drag-and-drop
- **PowerShell export scripts** for automated data extraction from Microsoft ecosystem
- **Optional Entra ID authentication** (free, uses existing M365 tenant)
- **CI/CD** via GitHub Actions (build + lint on every push)

---

## 2. Architecture

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.1 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS + shadcn/ui | v4 / base-ui |
| Charts | Recharts | 3.8 |
| Icons | Lucide React | 1.0 |
| Auth | NextAuth v5 + Microsoft Entra ID | 5.0-beta |
| Token mgmt | @azure/msal-node | 5.1 |
| Deployment | Vercel | Free tier |
| CI/CD | GitHub Actions | Node 20 |

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     DATA SOURCES                             │
│  Business Central API ─┐                                     │
│  Microsoft Graph API ──┤                                     │
│  Officient HR API ─────┤  OAuth2 / Basic Auth                │
│  Jira Cloud API ───────┤                                     │
│  Dell/Lenovo APIs ─────┘                                     │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              NEXT.JS API ROUTES (Server-side)                │
│  /api/dashboard  /api/invoices  /api/licenses                │
│  /api/budget     /api/vendors   /api/devices                 │
│  /api/personnel  /api/worklogs  /api/sync                    │
│  /api/settings   /api/auth/[...nextauth]                     │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              lib/data-source.ts (Abstraction Layer)          │
│                                                              │
│  isDemoMode() ──→ true:  Read from data/mock/*.json          │
│                   false: Call live API clients in lib/        │
│                                                              │
│  All pages call data-source functions, never APIs directly   │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              NEXT.JS PAGES (Server Components)               │
│  Fetch data → pass to Client Components for interactivity    │
│                                                              │
│              CLIENT COMPONENTS                               │
│  Charts (Recharts), Tables (shadcn), Filters, CSV Import     │
│  Data from localStorage (imported CSVs) overlays demo data   │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Demo mode by default** — `NEXT_PUBLIC_DEMO_MODE=true`. All API clients check this flag. When true, data comes from `data/mock/*.json`. No API calls are made.

2. **Server components for data, client components for interactivity** — Pages are async server components that call `data-source.ts` functions. Interactive elements (charts, tables, filters) are `"use client"` components receiving data as props.

3. **Icon serialization workaround** — Lucide icons can't be passed as props from server to client components (React serialization boundary). The `KPICard` component uses an `iconName: string` prop mapped to icons internally via `ICON_MAP`.

4. **CSV import uses localStorage** — Imported data persists in the browser via `localStorage`, not on the server. This works on Vercel free tier (no filesystem writes). The `lib/imported-data.ts` module fires `CustomEvent`s so components react to imports without page reloads.

5. **Auth is optional** — If `AUTH_MICROSOFT_ENTRA_ID_ID` env var is not set, the NextAuth middleware allows all requests. Auth can be enabled by adding 4 env vars without code changes.

6. **BC permission model** — Microsoft only offers `API.ReadWrite.All` (no read-only option). Defense in depth: assign a custom read-only permission set in BC itself. Documented in README.

---

## 3. Project Structure

```
it-budget-dashboard/
├── .github/workflows/
│   └── ci.yml                          # Build + lint on push/PR
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts # NextAuth catch-all
│   │   ├── budget/route.ts             # GET — budget entries
│   │   ├── dashboard/route.ts          # GET — aggregated KPIs + charts
│   │   ├── devices/route.ts            # GET — Intune devices
│   │   ├── invoices/route.ts           # GET — purchase invoices
│   │   ├── licenses/route.ts           # GET — M365 licenses
│   │   ├── personnel/route.ts          # GET — employees + KPIs
│   │   ├── settings/route.ts           # GET/POST — GL mappings, prices
│   │   ├── sync/route.ts              # POST — trigger data sync (cron)
│   │   ├── vendors/route.ts            # GET — vendor summaries
│   │   └── worklogs/route.ts           # GET — Jira worklogs
│   ├── auth/signin/page.tsx            # Custom sign-in page
│   ├── budget/page.tsx                 # Budget vs actual
│   ├── devices/page.tsx                # Device inventory
│   ├── import/page.tsx                 # CSV import (client component)
│   ├── invoices/page.tsx               # Invoice table
│   ├── licenses/page.tsx               # M365 license tracking
│   ├── personnel/page.tsx              # IT team + labor costs
│   ├── settings/page.tsx               # Configuration (client component)
│   ├── vendors/page.tsx                # Vendor analysis
│   ├── layout.tsx                      # Root layout (providers)
│   ├── page.tsx                        # Overview dashboard (home)
│   └── globals.css                     # Tailwind v4 + shadcn theme
├── components/
│   ├── budget/                         # BudgetTable, VarianceIndicator
│   ├── dashboard/                      # KPICard, SpendTrendChart,
│   │                                   # EntityComparison, TopVendors,
│   │                                   # CategoryBreakdown
│   ├── devices/                        # DeviceTable, AgeChart,
│   │                                   # ComplianceDonut
│   ├── import/                         # CsvImportCard
│   ├── invoices/                       # InvoiceTable
│   ├── layout/                         # Sidebar, Header, CompanyContext
│   ├── licenses/                       # LicenseCard, UtilizationGauge
│   ├── personnel/                      # DepartmentChart, ITTeamTable,
│   │                                   # ProjectCostDonut, WorklogTable
│   ├── vendors/                        # VendorList, VendorSpendChart
│   ├── ui/                             # 18 shadcn/ui base components
│   └── theme-provider.tsx              # next-themes wrapper
├── lib/
│   ├── auth.ts                         # NextAuth v5 config
│   ├── bc-client.ts                    # Business Central API client
│   ├── constants.ts                    # GL mappings, SKU names, thresholds
│   ├── csv-parser.ts                   # CSV parser + typed mappers
│   ├── data-source.ts                  # Central data abstraction
│   ├── demo-data.ts                    # Mock data loader
│   ├── graph-client.ts                 # Microsoft Graph API client
│   ├── imported-data.ts                # localStorage manager
│   ├── jira-client.ts                  # Jira Cloud API client
│   ├── officient-client.ts             # Officient HR API client
│   ├── types.ts                        # All TypeScript interfaces
│   ├── use-dashboard-data.ts           # React hook for imported data
│   ├── utils.ts                        # Currency/date formatting
│   └── warranty-client.ts              # Dell + Lenovo warranty APIs
├── data/mock/
│   ├── budget.json                     # 108 entries (9 categories × 12 months)
│   ├── companies.json                  # 4 entities
│   ├── devices.json                    # 132 devices
│   ├── employees.json                  # 33 employees
│   ├── gl-entries.json                 # 86 GL entries
│   ├── invoices.json                   # 94 invoices
│   ├── jira-worklogs.json              # 40 worklog entries
│   └── licenses.json                   # 9 M365 SKUs
├── scripts/
│   ├── Export-All.ps1                  # Run all exports at once
│   ├── Export-BCInvoices.ps1           # BC purchase invoices → CSV
│   ├── Export-IntuneDevices.ps1        # Intune devices → CSV
│   ├── Export-JiraWorklogs.ps1         # Jira worklogs → CSV
│   ├── Export-M365Licenses.ps1         # M365 licenses → CSV
│   └── README.md                       # Script setup guide
├── middleware.ts                        # Auth middleware
├── next.config.ts                      # Next.js config
├── vercel.json                         # Cron job (daily sync)
├── .env.example                        # All environment variables
├── LICENSE                             # MIT
└── README.md                           # Full documentation
```

---

## 4. Environment Variables

```env
# === Mode ===
NEXT_PUBLIC_DEMO_MODE=true              # true = mock data, false = live APIs

# === Authentication (optional) ===
AUTH_SECRET=                            # openssl rand -base64 32
AUTH_MICROSOFT_ENTRA_ID_ID=             # App registration client ID
AUTH_MICROSOFT_ENTRA_ID_SECRET=         # App registration client secret
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=      # Azure AD tenant GUID

# === Business Central ===
BC_TENANT_ID=                           # Azure AD tenant GUID
BC_CLIENT_ID=                           # Same app registration
BC_CLIENT_SECRET=                       # Same client secret
BC_ENVIRONMENT=production               # or "sandbox"

# === Officient HR (optional) ===
OFFICIENT_CLIENT_ID=
OFFICIENT_CLIENT_SECRET=

# === Jira (optional) ===
JIRA_BASE_URL=                          # e.g., https://yoursite.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=

# === Dell Warranty (optional) ===
DELL_CLIENT_ID=
DELL_CLIENT_SECRET=

# === Lenovo Warranty (optional) ===
LENOVO_CLIENT_ID=

# === Azure (optional) ===
AZURE_SUBSCRIPTION_ID=

# === App ===
SYNC_CRON_SECRET=                       # Protects POST /api/sync
```

All integrations are optional. The app works with zero env vars (demo mode).

---

## 5. Integration Status

### Fully Implemented (demo + live client ready)

| Integration | Client File | Auth Method | Endpoints Used |
|-------------|-------------|-------------|----------------|
| **Business Central** | `lib/bc-client.ts` | OAuth2 client credentials via MSAL | `/companies`, `/purchaseInvoices`, `/generalLedgerEntries`, `/accounts` |
| **Microsoft Graph** | `lib/graph-client.ts` | OAuth2 client credentials via MSAL | `/subscribedSkus`, `/deviceManagement/managedDevices`, `/users` |
| **Officient HR** | `lib/officient-client.ts` | OAuth2 client credentials | `/people`, `/teams`, `/assets`, `/people/{id}/current_wage` |
| **Jira Cloud** | `lib/jira-client.ts` | Basic Auth (email + API token) | `/search` with JQL + worklog expansion |
| **Dell TechDirect** | `lib/warranty-client.ts` | OAuth2 client credentials | `/asset-entitlements?servicetags=` |
| **Lenovo eSupport** | `lib/warranty-client.ts` | ClientID header | `/v2.5/warranty?serial=` |

### Not Yet Implemented (identified in roadmap)

| Integration | API Status | Priority | Notes |
|-------------|-----------|----------|-------|
| **Azure Cost Management** | API exists | High | POST query endpoint with cost grouping |
| **UniFi** | Official API at api.ui.com | High | API key auth, `/v1/devices` |
| **3CX** | XAPI v1 (OData) | Medium | Requires ENT+ license — verify with Connectify |
| **Sectigo** | REST API | Medium | Certificate inventory, no pricing data |
| **Peppol e-invoicing** | Mandatory since Jan 2026 | High | Need Nymus BC Connector or similar |
| **Barracuda** | JSON-RPC + SNMP | Low | Managed by EASI, high dependency |
| **Proximus** | No billing API | N/A | Manual CSV from MyProximus portal |
| **CodeTwo** | No API | N/A | Fixed annual cost, manual entry |
| **EASI** | No API | N/A | Request monthly CSV reports |

---

## 6. Data Model

### Core Types (lib/types.ts)

```
Financial:        Company, PurchaseInvoice, PurchaseInvoiceLine, GeneralLedgerEntry,
                  GLAccount, BudgetEntry, VendorSummary, CategorySpend, MonthlySpend,
                  EntitySpend, DashboardKPIs

Licensing:        M365License, LicensePrice

Devices:          ManagedDevice, WarrantyInfo

Personnel:        Employee, EmployeeAsset, DepartmentSummary, PersonnelKPIs,
                  JiraWorklog, JiraProjectCost

Configuration:    GLMapping, SyncStatus, DateRange, ITCategory, CompanyFilter
```

### Mock Data Volumes

| File | Records | Covers |
|------|---------|--------|
| companies.json | 4 | GDI, WHS, GRE, TDR |
| invoices.json | 94 | Jan–Dec 2025, 8 vendors, 7 cost categories |
| gl-entries.json | 86 | Matching GL postings |
| budget.json | 108 | 9 categories × 12 months |
| licenses.json | 9 | M365 SKUs with utilization data |
| devices.json | 132 | 95 laptops, 12 desktops, 25 mobile |
| employees.json | 33 | 4 IT, 29 other departments |
| jira-worklogs.json | 40 | 4 IT projects, Jan–Mar 2026 |

---

## 7. Key Code Patterns

### Data Source Abstraction (`lib/data-source.ts`)

Every data access goes through this file. Pattern:

```typescript
export async function getInvoices(companyFilter, dateFrom, dateTo) {
  if (isDemoMode()) {
    // Filter mock data from demo-data.ts
    return demoInvoices.filter(...);
  }
  // Live mode: call API client
  return fetchBCInvoices(companyId, dateFrom, dateTo);
}
```

Functions exported: `getCompanies`, `getInvoices`, `getGLEntries`, `getLicenses`, `getDevices`, `getBudgetEntries`, `getDashboardKPIs`, `getMonthlySpend`, `getCategorySpend`, `getEntitySpend`, `getVendorSummary`, `getEmployees`, `getJiraWorklogs`, `getJiraProjectCosts`, `getPersonnelKPIs`.

### Select Component Null Handling

shadcn/ui v4 uses base-ui which passes `string | null` to `onValueChange`. All Select handlers must guard against null:
```typescript
onValueChange={(v) => v && setSomeState(v)}
```

### Server → Client Component Boundary

React components (like Lucide icons) cannot be serialized across the server/client boundary. The `KPICard` uses string-based icon lookup:
```typescript
// Server component passes string:
<KPICard iconName="DollarSign" ... />

// Client component maps internally:
const ICON_MAP = { DollarSign, TrendingUp, Key, ... };
const Icon = ICON_MAP[iconName];
```

---

## 8. Authentication Flow

```
User visits any page
       │
       ▼
middleware.ts (auth middleware)
       │
       ├── AUTH_MICROSOFT_ENTRA_ID_ID not set? → Allow all (demo mode)
       │
       ├── User has session? → Allow
       │
       └── No session? → Redirect to /auth/signin
                              │
                              ▼
                    Sign in with Microsoft (Entra ID)
                              │
                              ▼
                    /api/auth/callback/microsoft-entra-id
                              │
                              ▼
                    Session created → redirect to /
```

To enable: add `AUTH_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` to environment. Add redirect URI `https://{domain}/api/auth/callback/microsoft-entra-id` to the Entra app registration.

---

## 9. CSV Import System

```
User drops CSV on /import page
       │
       ▼
lib/csv-parser.ts → parseCSV() → raw rows
       │
       ▼
mapInvoiceCSV() / mapBudgetCSV() / etc. → typed objects
  (flexible column name matching: camelCase, snake_case, "Human Readable")
       │
       ▼
lib/imported-data.ts → saveImportedData() → localStorage
       │
       ▼
CustomEvent("itdash-data-imported") fired
       │
       ▼
Components listening via useImportedData() hook react
```

Downloadable CSV templates with sample rows are generated client-side on the Import page.

---

## 10. PowerShell Export Scripts

All scripts in `scripts/` follow the same pattern:
1. Accept `-TenantId`, `-ClientId`, `-ClientSecret` (secret prompted securely if omitted)
2. Authenticate via OAuth2 client credentials
3. Paginate through API results (follow `@odata.nextLink`)
4. Export to CSV with `Export-Csv -NoTypeInformation -Encoding UTF8`

`Export-All.ps1` runs all scripts sequentially with shared credentials. Supports optional `-JiraBaseUrl` / `-JiraEmail` params.

---

## 11. Known Issues & Technical Debt

1. **Recharts SSR warnings** — "width(-1) and height(-1)" warnings during `next build` static generation. Harmless — Recharts can't measure `ResponsiveContainer` during SSR. Charts render correctly in browser.

2. **No database layer** — Demo mode uses static JSON, imported data uses localStorage. For production with live API sync, add PostgreSQL (Neon free tier or Azure) + Prisma ORM. The `data-source.ts` abstraction makes this a clean swap.

3. **No incremental sync** — The sync endpoint is a stub. Live mode needs delta queries (`$filter=lastModifiedDateTime gt {lastSync}`) to avoid re-pulling all data.

4. **Settings not persisted** — GL mappings and license prices edited on the Settings page are not saved server-side. Need a database or Vercel KV.

5. **Company filter is client-side only** — The `CompanyContext` works within a single page session but doesn't filter data at the API level. Server components fetch all data; filtering happens in `data-source.ts`.

6. **NextAuth v5 is beta** — Using `next-auth@5.0.0-beta.30`. Monitor for breaking changes before GA.

---

## 12. Next Steps (Priority Order)

### Phase 1: Production-Ready Data Layer
- [ ] Add PostgreSQL database (Neon free tier or Azure Belgium Central)
- [ ] Add Prisma ORM with models for: Company, Invoice, GLEntry, BudgetEntry, License, Device, Employee, Worklog, SyncLog
- [ ] Implement real sync logic in `/api/sync` — pull from BC + Graph, upsert into database
- [ ] Add incremental sync with delta timestamps
- [ ] Persist settings (GL mappings, license prices) to database

### Phase 2: Complete Live Integrations
- [ ] Wire up `data-source.ts` live mode functions to actual API clients
- [ ] Add Azure Cost Management integration (POST query API)
- [ ] Add UniFi network device inventory (API key auth, low effort)
- [ ] Verify 3CX license tier with Connectify NV (needs ENT+ for XAPI)
- [ ] Add warranty data enrichment to Devices page

### Phase 3: NIS2 Compliance & Azure Hosting
- [ ] Migrate from Vercel to Azure App Service B1 (~€12/month)
- [ ] Deploy to Azure Belgium Central region (data residency)
- [ ] Enable Azure AD authentication enforcement
- [ ] Add Azure Monitor for audit logging
- [ ] Document data processing in ROPA (GDPR/NIS2)
- [ ] Custom BC permission set (read-only) via Alistar/Dynavision

### Phase 4: Advanced Features
- [ ] Peppol e-invoicing integration (legally mandatory since Jan 2026 in Belgium)
- [ ] Holt-Winters forecasting for 12-month rolling predictions
- [ ] Sectigo certificate tracking
- [ ] SaaS spend discovery (shadow IT)
- [ ] Power Automate webhook endpoint for push-based data ingestion
- [ ] Scheduled PowerShell exports via Windows Task Scheduler

---

## 13. How to Run Locally

```bash
git clone https://github.com/Yasuke2000/it-budget-dashboard.git
cd it-budget-dashboard
npm install
cp .env.example .env.local
npm run dev
# Open http://localhost:3000
```

No API keys needed — demo mode with mock data works immediately.

## 14. How to Deploy

```bash
# Vercel (current)
npx vercel --prod

# Or connect GitHub repo to Vercel for auto-deploy on push
```

For NIS2-compliant hosting, migrate to Azure App Service B1 in Belgium Central.

---

*This document covers the full technical state of the project as of March 2026. All source code is in the GitHub repository with MIT license.*
