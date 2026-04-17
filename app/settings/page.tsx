"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Save,
  Info,
  Database,
  Code2,
  ExternalLink,
  Building2,
  Wifi,
  WifiOff,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_GL_MAPPING,
  IT_CATEGORIES,
  DEFAULT_LICENSE_PRICES,
  SKU_NAMES,
} from "@/lib/constants";
import type { GLMapping, LicensePrice } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GLMappingRow extends GLMapping {
  id: string;
}

interface LicensePriceRow extends LicensePrice {
  id: string;
}

interface SyncState {
  status: "idle" | "syncing" | "success" | "error";
  lastSyncAt: string | null;
  message: string;
}

// ─── Static demo companies ─────────────────────────────────────────────────

const DEMO_COMPANIES = [
  { id: "comp-gdi", name: "Acme Distribution International", active: true },
  { id: "comp-whs", name: "Warehouse Solutions", active: true },
  { id: "comp-gre", name: "Acme Real Estate", active: true },
  { id: "comp-tdr", name: "Transport De Rudder", active: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).substring(2, 10);
}

function buildInitialGLRows(): GLMappingRow[] {
  return Object.entries(DEFAULT_GL_MAPPING).map(([accountNumber, category]) => ({
    id: uid(),
    accountNumber,
    category,
  }));
}

function buildInitialLicenseRows(): LicensePriceRow[] {
  return Object.entries(DEFAULT_LICENSE_PRICES).map(([sku, price]) => ({
    id: uid(),
    skuPartNumber: sku,
    displayName: SKU_NAMES[sku] ?? sku,
    pricePerUser: price,
  }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SaveButton({
  onClick,
  saving,
  saved,
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={saving}
      className="bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-60 transition-colors"
    >
      {saving ? (
        <>
          <RefreshCw className="size-4 mr-2 animate-spin" />
          Saving…
        </>
      ) : saved ? (
        <>
          <CheckCircle2 className="size-4 mr-2 text-teal-200" />
          Saved
        </>
      ) : (
        <>
          <Save className="size-4 mr-2" />
          Save Changes
        </>
      )}
    </Button>
  );
}

// ─── Connection status types ──────────────────────────────────────────────────

interface ServiceStatus {
  configured: boolean;
  connected: boolean;
  error: string | null;
}

interface ConnectionStatus {
  demoMode: boolean;
  services: {
    bc: ServiceStatus;
    graph: ServiceStatus;
    jira: ServiceStatus;
    dell: ServiceStatus;
    lenovo: ServiceStatus;
  };
  cache: { size: number; keys: string[] };
}

// ─── Tab 1: General ───────────────────────────────────────────────────────────

function GeneralTab() {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  const [sync, setSync] = useState<SyncState>({
    status: "idle",
    lastSyncAt: "2025-03-23T08:14:32Z",
    message: "All data sources synced successfully.",
  });
  const [companies, setCompanies] = useState(DEMO_COMPANIES);
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);
  const [connLoading, setConnLoading] = useState(true);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data: ConnectionStatus) => setConnStatus(data))
      .catch(() => setConnStatus(null))
      .finally(() => setConnLoading(false));
  }, []);

  const handleSync = useCallback(async () => {
    setSync((s) => ({ ...s, status: "syncing", message: "Syncing data…" }));
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSync({
        status: "success",
        lastSyncAt: new Date().toISOString(),
        message: "All data sources synced successfully.",
      });
    } catch (err) {
      setSync((s) => ({
        ...s,
        status: "error",
        message: err instanceof Error ? err.message : "Sync failed.",
      }));
    }
  }, []);

  const toggleCompany = (id: string) => {
    setCompanies((cs) =>
      cs.map((c) => (c.id === id ? { ...c, active: !c.active } : c))
    );
  };

  const statusColor: Record<SyncState["status"], string> = {
    idle: "text-slate-400",
    syncing: "text-amber-400",
    success: "text-teal-400",
    error: "text-red-400",
  };

  const StatusIcon =
    sync.status === "success"
      ? CheckCircle2
      : sync.status === "error"
      ? XCircle
      : RefreshCw;

  const goLiveSteps = [
    {
      label: "Create Azure AD app registration",
      detail: "Register a new app in Microsoft Entra ID (Azure Active Directory).",
      link: { text: "Open Entra admin center →", href: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
    },
    {
      label: "Add API permissions (BC + Graph)",
      detail: (
        <span>
          Grant:{" "}
          {[
            "Financials.ReadWrite.All",
            "LicenseAssignment.Read.All",
            "Directory.Read.All",
            "DeviceManagementManagedDevices.Read.All",
          ].map((p) => (
            <code key={p} className="text-[10px] bg-slate-800 px-1 py-0.5 rounded text-teal-300 mx-0.5">{p}</code>
          ))}
        </span>
      ),
    },
    {
      label: "Create a client secret",
      detail: "Under Certificates & secrets, generate a new client secret. Note it down immediately.",
    },
    {
      label: "Configure BC (Entra Applications)",
      detail: "In Business Central, go to Entra Applications and register the app with the matching Client ID. Assign the appropriate permission set (e.g. D365 BASIC).",
    },
    {
      label: "Set environment variables in .env.local",
      detail: (
        <div className="mt-1 grid grid-cols-1 gap-y-0.5">
          {[
            "AUTH_MICROSOFT_ENTRA_ID_ID",
            "AUTH_MICROSOFT_ENTRA_ID_SECRET",
            "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
            "BC_TENANT_ID",
            "BC_CLIENT_ID",
            "BC_CLIENT_SECRET",
            "BC_COMPANY_ID",
            "BC_ENVIRONMENT",
          ].map((v) => (
            <code key={v} className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-teal-300 inline-block w-fit">
              {v}
            </code>
          ))}
        </div>
      ),
    },
    {
      label: 'Set NEXT_PUBLIC_DEMO_MODE=false',
      detail: (
        <span>
          In{" "}
          <code className="text-[10px] bg-slate-800 px-1 py-0.5 rounded text-teal-300">.env.local</code>
          {" "}set{" "}
          <code className="text-[10px] bg-slate-800 px-1 py-0.5 rounded text-teal-300">NEXT_PUBLIC_DEMO_MODE=false</code>
          . This disables all mock data generators.
        </span>
      ),
    },
    {
      label: "Restart dev server (or redeploy)",
      detail: "Run npm run dev (or redeploy to production). All API routes will now use real credentials.",
    },
  ];

  const integrationConnections: Array<{
    label: string;
    key: keyof ConnectionStatus["services"];
    description: string;
  }> = [
    { label: "Business Central", key: "bc", description: "BC_CLIENT_ID + BC_CLIENT_SECRET" },
    { label: "Microsoft Graph", key: "graph", description: "Same app registration as BC" },
    { label: "Jira Cloud", key: "jira", description: "JIRA_BASE_URL + JIRA_API_TOKEN" },
    { label: "Dell TechDirect", key: "dell", description: "DELL_CLIENT_ID + DELL_CLIENT_SECRET" },
    { label: "Lenovo eSupport", key: "lenovo", description: "LENOVO_CLIENT_ID" },
  ];

  return (
    <div className="space-y-6">

      {/* ── BIG MODE BADGE ─────────────────────────────────────────── */}
      <Card className={`border-2 ${isDemo ? "bg-amber-500/5 border-amber-500/40" : "bg-emerald-500/5 border-emerald-500/40"}`}>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${isDemo ? "bg-amber-500/15" : "bg-emerald-500/15"}`}>
              {isDemo
                ? <AlertTriangle className="size-6 text-amber-400" />
                : <Wifi className="size-6 text-emerald-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold tracking-widest uppercase mb-1.5 ${
                isDemo
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              }`}>
                {isDemo ? "DEMO MODE — Using sample data" : "LIVE MODE — Connected to real APIs"}
              </div>
              <p className="text-sm text-slate-400 leading-relaxed mt-1">
                {isDemo
                  ? "No real API calls are being made. All numbers are generated from static seed data. Follow the steps below to switch to live mode."
                  : "The dashboard is reading from real Business Central, Microsoft Graph, and other API integrations. All figures reflect actual data."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── GO-LIVE CHECKLIST (only shown in demo mode) ─────────────── */}
      {isDemo && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
              <Info className="size-4 text-amber-400" />
              How to go live — step-by-step
            </CardTitle>
            <CardDescription>
              Complete these steps to switch from demo mode to real data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {goLiveSteps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg bg-slate-800/60 border border-slate-700/60 px-4 py-3"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700 border border-slate-600 text-[11px] font-bold text-slate-300 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white leading-snug">{step.label}</p>
                  <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{step.detail}</div>
                  {"link" in step && step.link && (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-teal-400 hover:text-teal-300 text-xs mt-1 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {step.link.text}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── CONNECTION STATUS ───────────────────────────────────────── */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <Wifi className="size-4 text-slate-400" />
            Connection Status
          </CardTitle>
          <CardDescription>
            Shows which integrations have credentials configured in the environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {connLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
              <RefreshCw className="size-4 animate-spin" />
              Checking connections…
            </div>
          ) : connStatus === null ? (
            <p className="text-xs text-red-400">Could not reach /api/status.</p>
          ) : (
            integrationConnections.map(({ label, key, description }) => {
              const svc = connStatus.services[key];
              const connected = svc?.configured ?? false;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-2.5 gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {connected
                      ? <Wifi className="size-4 text-emerald-400 shrink-0" />
                      : <WifiOff className="size-4 text-slate-500 shrink-0" />
                    }
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white leading-tight">{label}</p>
                      <p className="text-[10px] font-mono text-slate-500 truncate">{description}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${svc?.connected ? "text-emerald-400" : connected ? "text-amber-400" : "text-slate-500"}`}>
                    {svc?.connected ? "Connected" : connected ? "Configured" : "Not set"}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── SYNC STATUS ─────────────────────────────────────────────── */}
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="size-4 text-slate-400" />
            Data Sync
          </CardTitle>
          <CardDescription>
            Manually trigger a full refresh from all connected data sources.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusIcon
                  className={`size-4 ${statusColor[sync.status]} ${
                    sync.status === "syncing" ? "animate-spin" : ""
                  }`}
                />
                <span className={`text-sm font-medium ${statusColor[sync.status]}`}>
                  {sync.status === "idle" && "Ready"}
                  {sync.status === "syncing" && "Syncing…"}
                  {sync.status === "success" && "Up to date"}
                  {sync.status === "error" && "Sync failed"}
                </span>
              </div>
              <p className="text-xs text-slate-500">{sync.message}</p>
              {sync.lastSyncAt && (
                <p className="text-xs text-slate-500">
                  Last sync:{" "}
                  {new Date(sync.lastSyncAt).toLocaleString("en-BE", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
            </div>
            <Button
              onClick={handleSync}
              disabled={sync.status === "syncing"}
              className="bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-60 transition-colors shrink-0"
            >
              <RefreshCw
                className={`size-4 mr-2 ${
                  sync.status === "syncing" ? "animate-spin" : ""
                }`}
              />
              Sync Now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── ACTIVE ENTITIES ─────────────────────────────────────────── */}
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <Building2 className="size-4 text-slate-400" />
            Active Entities
          </CardTitle>
          <CardDescription>
            Choose which Business Central companies are included in dashboard
            aggregations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {companies.map((company) => (
            <div
              key={company.id}
              className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Building2 className="size-4 text-slate-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">{company.name}</p>
                  <p className="text-xs text-slate-500">{company.id}</p>
                </div>
              </div>
              <Switch
                checked={company.active}
                onCheckedChange={() => toggleCompany(company.id)}
                className="data-[state=checked]:bg-teal-600"
              />
            </div>
          ))}
          <p className="text-xs text-slate-500 pt-1">
            Disabled entities are excluded from spend totals, variance
            calculations, and all charts.
          </p>
        </CardContent>
      </Card>

      {/* ── SETUP WIZARD ────────────────────────────────────────────── */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <Wand2 className="size-4 text-slate-400" />
            First-Run Setup Wizard
          </CardTitle>
          <CardDescription>
            Run the setup wizard again to reconfigure your data source connections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/setup">
            <Button
              variant="ghost"
              className="border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-sm"
            >
              <Wand2 className="size-4 mr-2" />
              Run Setup Wizard Again
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 2: GL Account Mapping ────────────────────────────────────────────────

function GLMappingTab() {
  const [rows, setRows] = useState<GLMappingRow[]>(buildInitialGLRows);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addRow = () => {
    setRows((r) => [
      ...r,
      { id: uid(), accountNumber: "", category: IT_CATEGORIES[0] },
    ]);
    setSaved(false);
  };

  const removeRow = (id: string) => {
    setRows((r) => r.filter((row) => row.id !== id));
    setSaved(false);
  };

  const updateAccount = (id: string, value: string) => {
    setRows((r) =>
      r.map((row) => (row.id === id ? { ...row, accountNumber: value } : row))
    );
    setSaved(false);
  };

  const updateCategory = (id: string, value: string) => {
    setRows((r) =>
      r.map((row) => (row.id === id ? { ...row, category: value } : row))
    );
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          glMapping: Object.fromEntries(
            rows
              .filter((r) => r.accountNumber.trim())
              .map((r) => [r.accountNumber.trim(), r.category])
          ),
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold">
            GL Account → IT Category Mapping
          </CardTitle>
          <CardDescription>
            Maps Business Central general ledger account numbers to dashboard
            cost categories. Postings to unmapped accounts are grouped under
            &ldquo;Other IT&rdquo; if they fall within the configured IT account
            ranges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-medium w-48">
                    GL Account No.
                  </TableHead>
                  <TableHead className="text-slate-400 font-medium">
                    IT Cost Category
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-slate-700 hover:bg-slate-800/50"
                  >
                    <TableCell className="py-2">
                      <Input
                        value={row.accountNumber}
                        onChange={(e) =>
                          updateAccount(row.id, e.target.value)
                        }
                        placeholder="e.g. 61100"
                        className="h-8 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500/20 w-36"
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Select
                        value={row.category}
                        onValueChange={(val) => val && updateCategory(row.id, val)}
                      >
                        <SelectTrigger className="h-8 bg-slate-800 border-slate-700 text-white w-56 focus:border-teal-500">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700 text-white">
                          {IT_CATEGORIES.map((cat) => (
                            <SelectItem
                              key={cat}
                              value={cat}
                              className="focus:bg-slate-700 focus:text-white"
                            >
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                        className="size-8 p-0 text-slate-500 hover:text-red-400 hover:bg-red-400/10"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-slate-500 py-8 text-sm"
                    >
                      No mappings defined. Add one below.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <Plus className="size-4 mr-2" />
              Add Mapping
            </Button>
            <SaveButton onClick={handleSave} saving={saving} saved={saved} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 3: License Prices ────────────────────────────────────────────────────

function LicensePricesTab() {
  const [rows, setRows] = useState<LicensePriceRow[]>(buildInitialLicenseRows);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updatePrice = (id: string, raw: string) => {
    const parsed = parseFloat(raw);
    const pricePerUser = isNaN(parsed) ? 0 : parsed;
    setRows((r) =>
      r.map((row) => (row.id === id ? { ...row, pricePerUser } : row))
    );
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licensePrices: Object.fromEntries(
            rows.map((r) => [r.skuPartNumber, r.pricePerUser])
          ),
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold">
            Microsoft License Prices
          </CardTitle>
          <CardDescription>
            Microsoft Graph APIs do not expose contracted prices. Enter your
            actual per-user monthly prices (excl. VAT, EUR) here so the
            Licenses page can calculate accurate costs and wasted spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-medium w-48">
                    SKU Part Number
                  </TableHead>
                  <TableHead className="text-slate-400 font-medium">
                    Display Name
                  </TableHead>
                  <TableHead className="text-slate-400 font-medium w-44 text-right pr-6">
                    Price / User / Month (EUR)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-slate-700 hover:bg-slate-800/50"
                  >
                    <TableCell className="py-2">
                      <code className="text-xs text-teal-300 bg-slate-800 px-2 py-1 rounded font-mono">
                        {row.skuPartNumber}
                      </code>
                    </TableCell>
                    <TableCell className="py-2 text-sm text-slate-300">
                      {row.displayName}
                    </TableCell>
                    <TableCell className="py-2 text-right pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-slate-400 text-sm">€</span>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={row.pricePerUser}
                          onChange={(e) => updatePrice(row.id, e.target.value)}
                          className="h-8 w-24 bg-slate-800 border-slate-700 text-white text-right focus:border-teal-500 focus:ring-teal-500/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-slate-500 max-w-md">
              Prices are stored locally in browser storage and applied at
              render time. They are not sent to Microsoft.
            </p>
            <SaveButton onClick={handleSave} saving={saving} saved={saved} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 4: About ─────────────────────────────────────────────────────────────

function AboutTab() {
  const techStack = [
    { label: "Framework", value: "Next.js 15 (App Router)" },
    { label: "Language", value: "TypeScript 5" },
    { label: "UI Components", value: "shadcn/ui + Base UI" },
    { label: "Styling", value: "Tailwind CSS v4" },
    { label: "Charts", value: "Recharts" },
    { label: "Icons", value: "Lucide React" },
  ];

  const dataSources = [
    {
      name: "Business Central API v2.0",
      description:
        "Purchase invoices, GL entries, vendors, and chart of accounts.",
      icon: Database,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      name: "Microsoft Graph API",
      description:
        "Microsoft 365 license assignments, Intune device inventory, and user data.",
      icon: Code2,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
    },
    {
      name: "Azure Cost Management API",
      description:
        "Azure subscription resource costs, grouped by service and resource group.",
      icon: Database,
      color: "text-teal-400",
      bg: "bg-teal-400/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* App info */}
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-teal-600/20 flex items-center justify-center shrink-0">
              <Database className="size-6 text-teal-400" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-white text-base font-semibold">
                IT Finance Dashboard
              </CardTitle>
              <CardDescription>
                Unified IT spend visibility across Business Central entities,
                Microsoft 365 licensing, and Azure cloud costs.
              </CardDescription>
              <Badge className="mt-1 bg-teal-500/20 text-teal-300 border-teal-500/30 text-xs">
                v1.0.0
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tech stack */}
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <Code2 className="size-4 text-slate-400" />
            Technology Stack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {techStack.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 gap-4"
              >
                <span className="text-xs text-slate-400 shrink-0">{label}</span>
                <span className="text-xs text-slate-200 font-medium text-right">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data sources */}
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <Database className="size-4 text-slate-400" />
            Data Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataSources.map(({ name, description, icon: Icon, color, bg }) => (
            <div
              key={name}
              className="flex items-start gap-3 rounded-lg bg-slate-800 px-4 py-3"
            >
              <div
                className={`size-8 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}
              >
                <Icon className={`size-4 ${color}`} />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-white">{name}</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Documentation links */}
      <Card className="bg-slate-900 border-slate-700 ring-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
            <ExternalLink className="size-4 text-slate-400" />
            Documentation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            {
              label: "Setup & Configuration Guide",
              href: "#",
              note: "Environment variables, API credentials, BC company setup",
            },
            {
              label: "GL Mapping Reference",
              href: "#",
              note: "How account numbers map to cost categories",
            },
            {
              label: "API Integration Overview",
              href: "#",
              note: "Authentication flows for BC, Graph, and Azure APIs",
            },
            {
              label: "Troubleshooting",
              href: "#",
              note: "Common errors, sync failures, and data discrepancies",
            },
          ].map(({ label, href, note }) => (
            <a
              key={label}
              href={href}
              className="flex items-start justify-between rounded-lg bg-slate-800 px-4 py-3 group hover:bg-slate-700 transition-colors"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-teal-400 group-hover:text-teal-300">
                  {label}
                </p>
                <p className="text-xs text-slate-500">{note}</p>
              </div>
              <ExternalLink className="size-3.5 text-slate-500 group-hover:text-slate-300 shrink-0 mt-1" />
            </a>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400">
          Configure data sources, account mappings, and licence prices.
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="bg-slate-800 border border-slate-700 h-auto p-1 gap-1 w-full sm:w-auto">
          <TabsTrigger
            value="general"
            className="text-slate-400 data-active:bg-slate-700 data-active:text-white px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            General
          </TabsTrigger>
          <TabsTrigger
            value="gl-mapping"
            className="text-slate-400 data-active:bg-slate-700 data-active:text-white px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            GL Mapping
          </TabsTrigger>
          <TabsTrigger
            value="license-prices"
            className="text-slate-400 data-active:bg-slate-700 data-active:text-white px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            License Prices
          </TabsTrigger>
          <TabsTrigger
            value="about"
            className="text-slate-400 data-active:bg-slate-700 data-active:text-white px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            About
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="general">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="gl-mapping">
            <GLMappingTab />
          </TabsContent>
          <TabsContent value="license-prices">
            <LicensePricesTab />
          </TabsContent>
          <TabsContent value="about">
            <AboutTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
