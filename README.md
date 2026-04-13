# IT Finance Dashboard

Multi-entity IT budget management dashboard for organizations running Microsoft 365 and Business Central. Tracks spend, budgets, licenses, vendors, contracts, and devices from a single interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYasuke2000%2Fit-budget-dashboard&env=NEXT_PUBLIC_DEMO_MODE&envDescription=Set%20to%20true%20for%20demo%20mode&project-name=it-budget-dashboard)

## What it does

| Page | Description |
|------|-------------|
| **Overview** | KPI cards with sparklines, 12-month spend trend, category breakdown, entity comparison, top vendors. PDF report download and markdown export. |
| **Invoices** | Searchable invoice table with vendor/category/date filters and CSV export. |
| **Licenses** | M365 license inventory with utilization rates, waste detection, cost per SKU. |
| **Budget** | Monthly budget vs actual tracking per category with variance indicators. |
| **Vendors** | Spend ranking, concentration risk alerts (>30% threshold), category breakdown per vendor. |
| **Devices** | Intune device fleet with compliance status, age distribution, OS breakdown. |
| **Personnel** | HR integration, IT cost per employee, department breakdown. |
| **Contracts** | Contract tracker with expiry countdown, timeline chart, renewal management. |
| **Insights** | AI-generated cost insights ranked by severity with savings estimates and recommended actions. |
| **Peppol** | Peppol e-invoicing viewer. |
| **Connectors** | Data source connection status for all integrations. |
| **Settings** | GL account mapping, license pricing, threshold configuration. |

### Extra features

- **AI Chat** — Sparkles button in header opens a chat panel powered by Gemini 2.5 Flash. Analyzes your dashboard data and answers questions about spend, licenses, vendors, and contracts. Works without an API key (demo responses).
- **PDF Report** — One-click A4 executive report with KPIs, categories, vendors, and expiring contracts. Generated client-side via jsPDF.
- **Markdown Export** — `/api/export` generates an LLM-ready markdown file with all dashboard data, optimized for pasting into ChatGPT/Claude/Gemini.
- **Command Palette** — `Cmd+K` / `Ctrl+K` for quick navigation across all pages and actions.
- **Multi-Company** — Supports multiple BC entities with consolidated and per-entity views.
- **Colorblind-safe** — Okabe-Ito chart palette safe for protanopia, deuteranopia, and tritanopia.

## Quick start

```bash
git clone https://github.com/Yasuke2000/it-budget-dashboard.git
cd it-budget-dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard loads immediately with realistic mock data — no configuration needed.

## Deploy to Vercel

1. Push to GitHub
2. Connect repo in [vercel.com](https://vercel.com)
3. Add environment variable: `NEXT_PUBLIC_DEMO_MODE` = `true`
4. Deploy

Optional: add `GOOGLE_GENERATIVE_AI_API_KEY` (free from [aistudio.google.com](https://aistudio.google.com)) to enable live AI chat, and `AUTH_SECRET` (run `openssl rand -base64 32`) for NextAuth.

## Docker

```bash
git clone https://github.com/Yasuke2000/it-budget-dashboard.git
cd it-budget-dashboard
docker compose up --build
# Open http://localhost:3000
```

Development with hot reload:
```bash
docker compose -f docker-compose.dev.yml up --build
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Charts | Recharts 3.8 |
| Auth | NextAuth v5 (Microsoft Entra ID SSO) |
| AI | Vercel AI SDK + Google Gemini 2.5 Flash |
| PDF | jsPDF + jspdf-autotable |
| Hosting | Vercel |

## Demo mode vs live mode

The dashboard has two modes controlled by `NEXT_PUBLIC_DEMO_MODE`:

- **`true` (default)** — All data comes from `data/mock/*.json`. No API calls. Works instantly.
- **`false`** — Connects to real APIs: Business Central for invoices/GL, Microsoft Graph for licenses/devices, Jira for worklogs. Falls back to demo data if any API fails.

Every data function checks `isDemoMode()` first. Live mode adds a cache layer (in-memory with TTL) to avoid hitting APIs on every page load.

## Environment variables

### Required (demo mode)

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_DEMO_MODE` | `true` |

### Required (live mode)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_DEMO_MODE` | `false` |
| `BC_TENANT_ID` | Azure AD tenant GUID |
| `BC_CLIENT_ID` | App registration client ID |
| `BC_CLIENT_SECRET` | App registration client secret |
| `BC_ENVIRONMENT` | `production` or `sandbox` |
| `AUTH_SECRET` | Random string for NextAuth (`openssl rand -base64 32`) |

### Optional

| Variable | Description |
|----------|-------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key for AI chat (free at [aistudio.google.com](https://aistudio.google.com)) |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra ID app client ID for SSO |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra ID app client secret for SSO |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | Tenant ID for SSO |
| `JIRA_BASE_URL` | Jira Cloud URL (e.g. `https://yoursite.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email |
| `JIRA_API_TOKEN` | Jira API token |
| `OFFICIENT_CLIENT_ID` | Officient HR client ID |
| `OFFICIENT_CLIENT_SECRET` | Officient HR client secret |
| `DELL_CLIENT_ID` | Dell TechDirect client ID (warranty lookup) |
| `DELL_CLIENT_SECRET` | Dell TechDirect client secret |
| `LENOVO_CLIENT_ID` | Lenovo eSupport client ID (warranty lookup) |
| `SYNC_CRON_SECRET` | Protects `POST /api/sync` endpoint |

Copy `.env.example` to `.env.local` for local development.

## Live mode setup

To connect to real Business Central and Microsoft Graph APIs:

1. **Register an app** in [Microsoft Entra admin center](https://entra.microsoft.com) (single-tenant)
2. **Add API permissions:**
   - Dynamics 365 Business Central: `API.ReadWrite.All`
   - Microsoft Graph: `Organization.Read.All`, `User.Read.All`, `DeviceManagementManagedDevices.Read.All`
3. **Grant admin consent** for the tenant
4. **Create a client secret** and copy it
5. **In Business Central**, go to Microsoft Entra Applications, add the Client ID, set State to Enabled
6. **Assign a read-only permission set** in BC (see Security section below)
7. **Set environment variables** in `.env.local` with `NEXT_PUBLIC_DEMO_MODE=false`
8. **Run a sync**: `POST /api/sync` with `Authorization: Bearer {SYNC_CRON_SECRET}` header

### Security: principle of least privilege

Microsoft does not offer a read-only BC API permission — only `API.ReadWrite.All` exists. To enforce least privilege:

- Do **not** assign `D365 BUS FULL ACCESS` to the app
- Create a custom permission set in BC granting only **Read** access to: G/L Entries, Purchase Invoices, Chart of Accounts, Dimensions
- No Insert, Modify, or Delete rights
- Even if the app token were compromised, it cannot modify financial data

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | KPIs, monthly spend, categories, entities, vendors |
| `/api/invoices` | GET | Purchase invoices with date/company filtering |
| `/api/licenses` | GET | M365 license inventory |
| `/api/budget` | GET | Budget entries |
| `/api/vendors` | GET | Vendor spend summary |
| `/api/devices` | GET | Managed device inventory |
| `/api/contracts` | GET | Contract list |
| `/api/personnel` | GET | Employee and department data |
| `/api/insights` | GET | Pre-computed cost insights |
| `/api/chat` | POST | AI chat (Gemini or demo responses) |
| `/api/export` | GET | LLM-ready markdown or JSON export |
| `/api/report` | GET | Data for PDF report generation |
| `/api/sync` | POST | Trigger data sync from all sources (requires auth) |
| `/api/status` | GET | Connection status for all integrations |
| `/api/peppol` | GET | Peppol e-invoices |
| `/api/worklogs` | GET | Jira worklog data |
| `/api/settings` | GET/POST | Dashboard configuration |

## Project structure

```
app/
  page.tsx                  # Overview dashboard
  budget/                   # Budget vs actual
  contracts/                # Contract tracker
  devices/                  # Device inventory
  invoices/                 # Invoice management
  licenses/                 # License tracking
  vendors/                  # Vendor analysis
  personnel/                # HR integration
  insights/                 # Cost insights
  connectors/               # Data source status
  settings/                 # Configuration
  api/                      # 17 API endpoints
components/
  dashboard/                # KPI cards, charts, breakdowns
  contracts/                # Contract table, timeline, badges
  ai/                       # Chat panel
  layout/                   # Sidebar, header, date picker
  ui/                       # shadcn/ui components
lib/
  data-source.ts            # Unified data layer (demo/live switch)
  bc-client.ts              # Business Central API client
  graph-client.ts           # Microsoft Graph API client
  jira-client.ts            # Jira Cloud API client
  warranty-client.ts        # Dell/Lenovo warranty API client
  sync-cache.ts             # In-memory cache with TTL
  cost-insights.ts          # Automated cost analysis engine
  pdf-report.ts             # PDF report generator
  types.ts                  # TypeScript interfaces
  constants.ts              # GL mappings, SKU names, colors
  utils.ts                  # Currency formatting, date helpers
data/mock/                  # Demo mode JSON files
```

## License

MIT
