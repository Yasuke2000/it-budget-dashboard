# IT Finance Dashboard

A comprehensive IT budget management and cost analysis dashboard built for IT managers overseeing multi-entity organizations. Pulls financial data from Business Central, M365 license info from Microsoft Graph, Azure costs, and Intune device inventory — all through a single Azure AD app registration.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Executive Overview** — KPI cards, 12-month spend vs budget trend, entity comparison, cost category breakdown
- **Invoice Management** — Filterable, searchable, sortable data table with CSV export
- **M365 License Tracking** — Utilization gauges, waste identification, cost per SKU
- **Budget vs Actual** — Monthly variance tracking with traffic-light indicators (green/amber/red)
- **Vendor Analysis** — Spend ranking, concentration risk alerts (>30% threshold), drill-through to invoices
- **Device Inventory** — Intune-synced fleet with compliance status, age distribution, lifecycle alerts
- **Settings** — GL account mapping, license price configuration, sync management
- **Multi-Company** — Supports 4 BC entities (GDI, WHS, GRE, TDR) with consolidated and per-entity views
- **Demo Mode** — Works immediately with realistic mock data, no API connections required

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Charts | Recharts |
| Icons | Lucide React |
| Auth | @azure/msal-node (server-side, client credentials) |
| Deployment | Vercel (free tier compatible) |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/it-budget-dashboard.git
cd it-budget-dashboard

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local

# Run in demo mode (default)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the dashboard loads with realistic mock data immediately.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_DEMO_MODE` | No | `true` (default) for mock data, `false` for live APIs |
| `BC_TENANT_ID` | Live mode | Azure AD tenant GUID |
| `BC_CLIENT_ID` | Live mode | App registration client ID |
| `BC_CLIENT_SECRET` | Live mode | App registration client secret |
| `BC_ENVIRONMENT` | Live mode | BC environment name (`production` or `sandbox`) |
| `AZURE_SUBSCRIPTION_ID` | Optional | For Azure Cost Management API |
| `SYNC_CRON_SECRET` | Optional | Secret for protecting the sync API endpoint |

## Live Mode Setup

To connect to real Business Central and Microsoft Graph APIs:

1. **Register an app** in Microsoft Entra admin center (single-tenant)
2. **Add API permissions:**
   - Dynamics 365 Business Central → `API.ReadWrite.All`
   - Microsoft Graph → `Organization.Read.All`, `User.Read.All`, `DeviceManagementManagedDevices.Read.All`
3. **Grant admin consent**
4. **Create a client secret**
5. **In BC**, go to Microsoft Entra Applications → add the Client ID → set State to Enabled → assign `D365 BUS FULL ACCESS`
6. **Set environment variables** in `.env.local` with `NEXT_PUBLIC_DEMO_MODE=false`

## Project Structure

```
app/                    # Next.js App Router pages + API routes
  api/                  # Server-side API endpoints
  budget/               # Budget vs actual page
  devices/              # Device inventory page
  invoices/             # Invoice management page
  licenses/             # M365 license tracking page
  settings/             # Configuration page
  vendors/              # Vendor analysis page
components/
  dashboard/            # Overview page components (KPI cards, charts)
  budget/               # Budget table, variance indicators
  devices/              # Device table, age chart, compliance donut
  invoices/             # Invoice table with filters
  licenses/             # License cards, utilization gauges
  vendors/              # Vendor list, spend chart
  layout/               # Sidebar, header, company context
  ui/                   # shadcn/ui base components
lib/
  bc-client.ts          # Business Central API client
  graph-client.ts       # Microsoft Graph API client
  data-source.ts        # Data abstraction (demo vs live mode)
  demo-data.ts          # Mock data loader
  types.ts              # TypeScript type definitions
  constants.ts          # GL mappings, SKU names, thresholds
  utils.ts              # Currency formatting, date helpers
data/mock/              # Demo mode JSON files
```

## Data Architecture

The dashboard uses an **ETL pattern**: rather than hitting BC's API on every page load, data is synced into a local data layer. In demo mode, this is static JSON files. In production, you'd use PostgreSQL with scheduled sync jobs.

```
Business Central API  →  /api/sync  →  Local data store  →  Dashboard pages
Microsoft Graph API   →             →                    →
Azure Cost Mgmt API   →             →                    →
```

## Cost Categorization

IT costs are categorized using the **TBM (Technology Business Management) framework**:

| GL Account Range | Category | Examples |
|-----------------|----------|----------|
| 61xxx | Software & Licenses | M365, SaaS tools |
| 62xxx | Telecom | Internet, mobile, MPLS |
| 63xxx | External IT Services | Consulting, managed services |
| 64xxx | IT Personnel | Salaries, contractors |
| 23xxx | Hardware (Depreciation) | Laptop/server depreciation |
| 60xxx | Cloud & Hosting | Azure, AWS, hosting |
| 65xxx | Security | Firewall, antivirus |

## Deployment

### Vercel (recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy — zero config for Next.js

The `vercel.json` includes a daily cron job at 06:00 UTC to trigger data sync.

## License

MIT
