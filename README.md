# IT Finance Dashboard

A comprehensive IT budget management and cost analysis dashboard built for IT managers overseeing multi-entity organizations. Pulls financial data from Business Central, M365 license info from Microsoft Graph, Azure costs, and Intune device inventory — all through a single Azure AD app registration.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)

## One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYasuke2000%2Fit-budget-dashboard&env=NEXT_PUBLIC_DEMO_MODE&envDescription=Set%20to%20true%20for%20demo%20mode%20or%20false%20for%20live%20APIs&envLink=https%3A%2F%2Fgithub.com%2FYasuke2000%2Fit-budget-dashboard%23environment-variables&project-name=it-budget-dashboard)

Or run locally with Docker:

```bash
git clone https://github.com/Yasuke2000/it-budget-dashboard.git
cd it-budget-dashboard
docker compose up --build
# Open http://localhost:3000
```

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
git clone https://github.com/Yasuke2000/it-budget-dashboard.git
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
5. **In BC**, go to Microsoft Entra Applications → add the Client ID → set State to Enabled
6. **Assign a custom read-only permission set** (see Security Note below)
7. **Set environment variables** in `.env.local` with `NEXT_PUBLIC_DEMO_MODE=false`

### Security Note: Principle of Least Privilege

Microsoft does not offer a read-only `API.Read.All` permission for Business Central — only `API.ReadWrite.All` exists. This is a known limitation. To enforce least privilege:

- **Do NOT assign `D365 BUS FULL ACCESS`** to the app registration
- Instead, create a **custom permission set** in BC that grants only **Read** access to the tables this dashboard needs: G/L Entries, Purchase Invoices, Chart of Accounts, Dimensions
- No Insert, Modify, or Delete rights — the app can effectively only read, even though the Azure AD permission is ReadWrite
- Ask your BC partner (Alistar/Dynavision) to set this up

This defense-in-depth approach ensures that even if the app token were compromised, it cannot modify any financial data in Business Central.

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

### Option 1: Vercel (recommended for getting started)

Click the **Deploy with Vercel** button at the top of this README, or:

1. Push to GitHub
2. Connect repo to Vercel
3. Set `NEXT_PUBLIC_DEMO_MODE=true`
4. Deploy — zero config for Next.js

### Option 2: Docker Compose (recommended for production)

```bash
# Clone and start
git clone https://github.com/Yasuke2000/it-budget-dashboard.git
cd it-budget-dashboard
cp .env.example .env
# Edit .env with your credentials
docker compose up --build -d

# Dashboard: http://localhost:3000
# PostgreSQL: localhost:5432
```

Development with hot reload:
```bash
docker compose -f docker-compose.dev.yml up --build
```

### Option 3: Azure App Service (NIS2 compliant)

For production with real data in Belgium:
1. Deploy to Azure App Service B1 (~€12/month) in Belgium Central region
2. Use Azure Database for PostgreSQL Flexible Server
3. Enable Entra ID authentication
4. See [HANDOFF.md](HANDOFF.md) for full migration guide

## First-Run Setup

On first visit, a setup wizard guides you through connecting your data sources. You can also access it anytime from **Settings → Run Setup Wizard Again**.

The wizard walks you through:
1. Choosing demo mode or live data
2. Connecting Microsoft 365 (licenses, devices, SSO)
3. Connecting Business Central (invoices, GL entries, budget)
4. Optional integrations (Jira, Officient HR, Samsung Knox)

## License

MIT
