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
import { PageHeader } from "@/components/layout/page-header";
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

interface CompanyToggle {
  id: string;
  name: string;
  active: boolean;
}

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
      className="bg-primary hover:bg-primary text-primary-foreground disabled:opacity-60 transition-colors"
    >
      {saving ? (
        <>
          <RefreshCw className="size-4 mr-2 animate-spin" />
          Saving…
        </>
      ) : saved ? (
        <>
          <CheckCircle2 className="size-4 mr-2 text-primary" />
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
    officient: ServiceStatus;
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
  const [companies, setCompanies] = useState<CompanyToggle[]>([]);
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);
  const [connLoading, setConnLoading] = useState(true);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data: ConnectionStatus) => setConnStatus(data))
      .catch(() => setConnStatus(null))
      .finally(() => setConnLoading(false));
  }, []);

  // Real Business Central companies (not demo placeholders).
  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data: { id: string; name: string }[]) => {
        if (Array.isArray(data)) setCompanies(data.map((c) => ({ id: c.id, name: c.name, active: true })));
      })
      .catch(() => {});
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
    idle: "text-muted-foreground",
    syncing: "text-warning",
    success: "text-primary",
    error: "text-negative",
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
            <code key={p} className="text-[10px] bg-muted px-1 py-0.5 rounded text-primary mx-0.5">{p}</code>
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
            <code key={v} className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-primary inline-block w-fit">
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
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded text-primary">.env.local</code>
          {" "}set{" "}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded text-primary">NEXT_PUBLIC_DEMO_MODE=false</code>
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
    { label: "Officient HR", key: "officient", description: "OFFICIENT_API_TOKEN or OAuth client" },
    { label: "Dell TechDirect", key: "dell", description: "DELL_CLIENT_ID + DELL_CLIENT_SECRET" },
    { label: "Lenovo eSupport", key: "lenovo", description: "LENOVO_CLIENT_ID" },
  ];

  return (
    <div className="space-y-6">

      {/* ── BIG MODE BADGE ─────────────────────────────────────────── */}
      <Card className={`border-2 ${isDemo ? "bg-warning/5 border-warning/40" : "bg-positive/5 border-positive/40"}`}>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${isDemo ? "bg-warning/15" : "bg-positive/15"}`}>
              {isDemo
                ? <AlertTriangle className="size-6 text-warning" />
                : <Wifi className="size-6 text-positive" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold tracking-widest uppercase mb-1.5 ${
                isDemo
                  ? "bg-warning/20 text-warning border border-warning/40"
                  : "bg-positive/20 text-positive border border-positive/40"
              }`}>
                {isDemo ? "DEMO MODE — Using sample data" : "LIVE MODE — Connected to real APIs"}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1">
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
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
              <Info className="size-4 text-warning" />
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
                className="flex items-start gap-3 rounded-lg bg-accent border border-border px-4 py-3"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted border border-border text-[11px] font-bold text-foreground mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-snug">{step.label}</p>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.detail}</div>
                  {"link" in step && step.link && (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-xs mt-1 transition-colors"
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
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <Wifi className="size-4 text-muted-foreground" />
            Connection Status
          </CardTitle>
          <CardDescription>
            Shows which integrations have credentials configured in the environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {connLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <RefreshCw className="size-4 animate-spin" />
              Checking connections…
            </div>
          ) : connStatus === null ? (
            <p className="text-xs text-negative">Could not reach /api/status.</p>
          ) : (
            integrationConnections.map(({ label, key, description }) => {
              const svc = connStatus.services[key];
              const connected = svc?.configured ?? false;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5 gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {connected
                      ? <Wifi className="size-4 text-positive shrink-0" />
                      : <WifiOff className="size-4 text-muted-foreground shrink-0" />
                    }
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">{description}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${svc?.connected ? "text-positive" : connected ? "text-warning" : "text-muted-foreground"}`}>
                    {svc?.connected ? "Connected" : connected ? "Configured" : "Not set"}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── SYNC STATUS ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="size-4 text-muted-foreground" />
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
              <p className="text-xs text-muted-foreground">{sync.message}</p>
              {sync.lastSyncAt && (
                <p className="text-xs text-muted-foreground">
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
              className="bg-primary hover:bg-primary text-primary-foreground disabled:opacity-60 transition-colors shrink-0"
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
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            Active Entities
          </CardTitle>
          <CardDescription>
            Choose which Business Central companies are included in dashboard
            aggregations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {companies.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No companies loaded yet…</p>
          )}
          {companies.map((company) => (
            <div
              key={company.id}
              className="flex items-center justify-between rounded-lg bg-muted px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Building2 className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{company.name}</p>
                  <p className="text-xs text-muted-foreground">{company.id}</p>
                </div>
              </div>
              <Switch
                checked={company.active}
                onCheckedChange={() => toggleCompany(company.id)}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-1">
            Disabled entities are excluded from spend totals, variance
            calculations, and all charts.
          </p>
        </CardContent>
      </Card>

      {/* ── SETUP WIZARD ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <Wand2 className="size-4 text-muted-foreground" />
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
              className="border border-border text-foreground hover:text-foreground hover:border-border-strong text-sm"
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

  // Hydrate from the persisted, server-side mapping (defaults + saved overrides)
  // so edits round-trip and the live dashboard reflects exactly this list.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.glMappings) {
          setRows(
            Object.entries(d.glMappings as Record<string, string>).map(([accountNumber, category]) => ({
              id: uid(),
              accountNumber,
              category,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

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
          glMappings: Object.fromEntries(
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
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">
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
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium w-48">
                    GL Account No.
                  </TableHead>
                  <TableHead className="text-muted-foreground font-medium">
                    IT Cost Category
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-border hover:bg-accent"
                  >
                    <TableCell className="py-2">
                      <Input
                        value={row.accountNumber}
                        onChange={(e) =>
                          updateAccount(row.id, e.target.value)
                        }
                        placeholder="e.g. 61100"
                        className="h-8 bg-muted border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/20 w-36"
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Select
                        value={row.category}
                        onValueChange={(val) => val && updateCategory(row.id, val)}
                      >
                        <SelectTrigger className="h-8 bg-muted border-border text-foreground w-56 focus:border-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-muted border-border text-foreground">
                          {IT_CATEGORIES.map((cat) => (
                            <SelectItem
                              key={cat}
                              value={cat}
                              className="focus:bg-accent focus:text-foreground"
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
                        className="size-8 p-0 text-muted-foreground hover:text-negative hover:bg-negative/10"
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
                      className="text-center text-muted-foreground py-8 text-sm"
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
              className="border-border bg-muted text-foreground hover:bg-accent hover:text-foreground"
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

// ─── Tab: Budget ───────────────────────────────────────────────────────────────

// PCMN-kostenklassen waarvoor een CFO-jaardoel gezet kan worden.
const CFO_CLASSES: { cls: string; label: string }[] = [
  { cls: "60", label: "60 · Aankopen & handelsgoederen" },
  { cls: "61", label: "61 · Diensten & diverse goederen" },
  { cls: "62", label: "62 · Bezoldigingen & sociale lasten" },
  { cls: "63", label: "63 · Afschrijvingen & waardeverm." },
  { cls: "64", label: "64 · Andere bedrijfskosten" },
];

function BudgetTab() {
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [consolidatedRevenue, setConsolidatedRevenue] = useState("");
  const [benchmarkPct, setBenchmarkPct] = useState("");
  const [cfoRev, setCfoRev] = useState("");
  const [cfoCost, setCfoCost] = useState("");
  const [cfoClass, setCfoClass] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.budgets) {
          const b: Record<string, string> = {};
          for (const [k, v] of Object.entries(d.budgets as Record<string, number>)) b[k] = String(v);
          setBudgets(b);
        }
        if (d && typeof d.consolidatedRevenue === "number" && d.consolidatedRevenue > 0) setConsolidatedRevenue(String(d.consolidatedRevenue));
        if (d && typeof d.revenueBenchmarkPercent === "number") setBenchmarkPct(String(d.revenueBenchmarkPercent));
        if (d && typeof d.cfoRevenueTarget === "number" && d.cfoRevenueTarget > 0) setCfoRev(String(d.cfoRevenueTarget));
        if (d && typeof d.cfoCostTarget === "number" && d.cfoCostTarget > 0) setCfoCost(String(d.cfoCostTarget));
        if (d && d.cfoClassTargets) {
          const c: Record<string, string> = {};
          for (const [k, v] of Object.entries(d.cfoClassTargets as Record<string, number>)) c[k] = String(v);
          setCfoClass(c);
        }
      })
      .catch(() => {});
  }, []);

  const update = (cat: string, raw: string) => {
    setBudgets((b) => ({ ...b, [cat]: raw }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed: Record<string, number> = {};
      for (const [cat, raw] of Object.entries(budgets)) {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) parsed[cat] = n;
      }
      const rev = parseFloat(consolidatedRevenue);
      const bench = parseFloat(benchmarkPct);
      const cRev = parseFloat(cfoRev);
      const cCost = parseFloat(cfoCost);
      const classTargets: Record<string, number> = {};
      for (const [cls, raw] of Object.entries(cfoClass)) {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) classTargets[cls] = n;
      }
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budgets: parsed,
          consolidatedRevenue: Number.isFinite(rev) && rev > 0 ? rev : 0,
          revenueBenchmarkPercent: Number.isFinite(bench) && bench > 0 ? bench : 3.3,
          cfoRevenueTarget: Number.isFinite(cRev) && cRev > 0 ? cRev : 0,
          cfoCostTarget: Number.isFinite(cCost) && cCost > 0 ? cCost : 0,
          cfoClassTargets: classTargets,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">Revenue & IT-Spend Benchmark</CardTitle>
          <CardDescription>
            IT spend as a % of revenue is the key economic benchmark. We use gross BC turnover by default,
            but that&apos;s inflated by intercompany — enter your <strong>audited consolidated revenue</strong>
            (after eliminations) for an accurate ratio. The benchmark % is the industry median to compare
            against (transport &amp; logistics ≈ 3.3%, Gartner IT Key Metrics 2025).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Consolidated annual revenue (EUR) — optional</label>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-sm">€</span>
                <Input type="number" min={0} step={100000} value={consolidatedRevenue}
                  onChange={(e) => { setConsolidatedRevenue(e.target.value); setSaved(false); }}
                  placeholder="leave blank to use gross BC turnover"
                  className="h-8 bg-muted border-border text-foreground focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Benchmark IT-spend % of revenue</label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={0} step={0.1} value={benchmarkPct}
                  onChange={(e) => { setBenchmarkPct(e.target.value); setSaved(false); }}
                  placeholder="3.3"
                  className="h-8 w-28 bg-muted border-border text-foreground focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">CFO Cockpit — jaardoelen (groep)</CardTitle>
          <CardDescription>
            Jaardoelen voor de financiële cockpit (/cfo): omzet- en kostendoel voor de budgetlijn,
            plus optioneel een <strong>jaardoel per PCMN-kostenklasse</strong> — de cockpit toont dan
            per klasse de afwijking t.o.v. het pro-rata doel. Bedragen in EUR per jaar; leeg = geen doel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Omzetdoel (EUR/jaar)</label>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-sm">€</span>
                <Input type="number" min={0} step={500000} value={cfoRev}
                  onChange={(e) => { setCfoRev(e.target.value); setSaved(false); }}
                  placeholder="bv. 66000000"
                  className="h-8 bg-muted border-border text-foreground focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Kostendoel (EUR/jaar)</label>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-sm">€</span>
                <Input type="number" min={0} step={500000} value={cfoCost}
                  onChange={(e) => { setCfoCost(e.target.value); setSaved(false); }}
                  placeholder="bv. 62000000"
                  className="h-8 bg-muted border-border text-foreground focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CFO_CLASSES.map(({ cls, label }) => (
              <div key={cls} className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{label}</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-sm">€</span>
                  <Input type="number" min={0} step={100000} value={cfoClass[cls] ?? ""}
                    onChange={(e) => { setCfoClass((c) => ({ ...c, [cls]: e.target.value })); setSaved(false); }}
                    placeholder="geen doel"
                    className="h-8 bg-muted border-border text-foreground focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">Monthly Budget by Category</CardTitle>
          <CardDescription>
            Enter a <strong>monthly</strong> budget (EUR, excl. VAT) per IT cost category. The Budget
            page and dashboard then show variance vs your real spend. Leave blank/0 for no budget.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">Category</TableHead>
                  <TableHead className="text-muted-foreground font-medium w-56 text-right pr-6">
                    Monthly Budget (EUR)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {IT_CATEGORIES.map((cat) => (
                  <TableRow key={cat} className="border-border hover:bg-accent">
                    <TableCell className="py-2 text-sm text-foreground">{cat}</TableCell>
                    <TableCell className="py-2 text-right pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-muted-foreground text-sm">€</span>
                        <Input
                          type="number"
                          min={0}
                          step={100}
                          value={budgets[cat] ?? ""}
                          onChange={(e) => update(cat, e.target.value)}
                          placeholder="0"
                          className="h-8 w-32 bg-muted border-border text-foreground text-right focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-end gap-4">
            <SaveButton onClick={handleSave} saving={saving} saved={saved} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: IT Vendors (allowlist) ───────────────────────────────────────────────

interface VendorRuleRow {
  id: string;
  pattern: string;
  category: string;
}

function VendorRulesTab() {
  const [rows, setRows] = useState<VendorRuleRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.itVendorRules) {
          setRows(
            Object.entries(d.itVendorRules as Record<string, string>).map(([pattern, category]) => ({
              id: uid(),
              pattern,
              category,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const addRow = () => {
    setRows((r) => [...r, { id: uid(), pattern: "", category: IT_CATEGORIES[0] }]);
    setSaved(false);
  };
  const removeRow = (id: string) => {
    setRows((r) => r.filter((row) => row.id !== id));
    setSaved(false);
  };
  const updatePattern = (id: string, value: string) => {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, pattern: value } : row)));
    setSaved(false);
  };
  const updateCategory = (id: string, value: string) => {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, category: value } : row)));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itVendorRules: Object.fromEntries(
            rows
              .filter((r) => r.pattern.trim())
              .map((r) => [r.pattern.trim().toLowerCase(), r.category])
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
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">IT Vendor Allowlist</CardTitle>
          <CardDescription>
            Vendors whose spend should count as IT <em>regardless of which G/L account it lands on</em>
            (e.g. iDocta, or Canon printers booked to office supplies). Matching is case-insensitive on
            the supplier name — &ldquo;canon&rdquo; matches &ldquo;CANON BELGIUM NV/SA&rdquo;. Only
            invoices not already counted via an IT account are added, so nothing double-counts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium w-64">Vendor name contains…</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Cost Category</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="border-border hover:bg-accent">
                    <TableCell className="py-2">
                      <Input
                        value={row.pattern}
                        onChange={(e) => updatePattern(row.id, e.target.value)}
                        placeholder="e.g. idocta"
                        className="h-8 bg-muted border-border text-foreground placeholder:text-muted-foreground focus:border-primary w-56"
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Select value={row.category} onValueChange={(val) => val && updateCategory(row.id, val)}>
                        <SelectTrigger className="h-8 bg-muted border-border text-foreground w-56 focus:border-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-muted border-border text-foreground">
                          {IT_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat} className="focus:bg-accent focus:text-foreground">
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
                        className="size-8 p-0 text-muted-foreground hover:text-negative hover:bg-negative/10"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8 text-sm">
                      No vendor rules. Add one below.
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
              className="border-border bg-muted text-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4 mr-2" />
              Add Vendor
            </Button>
            <SaveButton onClick={handleSave} saving={saving} saved={saved} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Operational Software ────────────────────────────────────────────────

function OperationalSoftwareTab() {
  const [vendors, setVendors] = useState<{ id: string; pattern: string }[]>([]);
  const [include, setInclude] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.operationalSoftwareVendors)) {
          setVendors(d.operationalSoftwareVendors.map((p: string) => ({ id: uid(), pattern: p })));
        }
        if (typeof d?.includeOperationalSoftware === "boolean") setInclude(d.includeOperationalSoftware);
      })
      .catch(() => {});
  }, []);

  const addRow = () => { setVendors((v) => [...v, { id: uid(), pattern: "" }]); setSaved(false); };
  const removeRow = (id: string) => { setVendors((v) => v.filter((r) => r.id !== id)); setSaved(false); };
  const updateRow = (id: string, value: string) => { setVendors((v) => v.map((r) => (r.id === id ? { ...r, pattern: value } : r))); setSaved(false); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationalSoftwareVendors: vendors.map((v) => v.pattern.trim().toLowerCase()).filter(Boolean),
          includeOperationalSoftware: include,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">Operational / Business-System Software</CardTitle>
          <CardDescription>
            Transport software that runs the <em>business</em> rather than the IT estate — TMS, telematics,
            route &amp; port platforms (Transics, PTV, Trimble, Eurotracs, Transporeon…). These are tagged
            as a separate &ldquo;Operational Software&rdquo; category. Use the toggle to decide whether they
            count toward your IT total. Matching is case-insensitive on the supplier name.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-accent px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Count operational software in the IT total</p>
              <p className="text-xs text-muted-foreground">
                {include
                  ? "On — shown as its own “Operational Software” category and included in IT spend."
                  : "Off — excluded from IT spend (treated as non-IT business cost)."}
              </p>
            </div>
            <Switch checked={include} onCheckedChange={(v) => { setInclude(Boolean(v)); setSaved(false); }} />
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">Vendor name contains…</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((row) => (
                  <TableRow key={row.id} className="border-border hover:bg-accent">
                    <TableCell className="py-2">
                      <Input
                        value={row.pattern}
                        onChange={(e) => updateRow(row.id, e.target.value)}
                        placeholder="e.g. transics"
                        className="h-8 bg-muted border-border text-foreground placeholder:text-muted-foreground focus:border-primary w-64"
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Button variant="ghost" size="sm" onClick={() => removeRow(row.id)} className="size-8 p-0 text-muted-foreground hover:text-negative hover:bg-negative/10">
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {vendors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-8 text-sm">
                      No operational-software vendors. Add one below.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Button variant="outline" size="sm" onClick={addRow} className="border-border bg-muted text-foreground hover:bg-accent hover:text-foreground">
              <Plus className="size-4 mr-2" />
              Add Vendor
            </Button>
            <SaveButton onClick={handleSave} saving={saving} saved={saved} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab: Features (beta toggles) ─────────────────────────────────────────────

function FeaturesTab() {
  const [showPeppol, setShowPeppol] = useState(false);
  const [licBuffer, setLicBuffer] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.showPeppol === "boolean") setShowPeppol(d.showPeppol);
        if (typeof d?.licenseBufferSeats === "number" && d.licenseBufferSeats > 0) setLicBuffer(String(d.licenseBufferSeats));
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const buf = parseInt(licBuffer, 10);
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showPeppol,
          licenseBufferSeats: Number.isFinite(buf) && buf > 0 ? buf : 0,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">Beta / Optional Features</CardTitle>
          <CardDescription>
            Toggle features that aren&apos;t fully wired to a live source yet. Off by default so they
            don&apos;t show half-finished.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-accent px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Peppol e-invoicing page</p>
              <p className="text-xs text-muted-foreground">
                {showPeppol
                  ? "On — shown in the navigation."
                  : "Off — hidden from the navigation. It isn't connected to a live Peppol Access Point yet (manual UBL upload + compliance reference only)."}
              </p>
            </div>
            <Switch checked={showPeppol} onCheckedChange={(v) => { setShowPeppol(Boolean(v)); setSaved(false); }} />
          </div>

          <div className="rounded-lg border border-border bg-accent px-4 py-3 space-y-1.5">
            <p className="text-sm font-medium text-foreground">License optimization buffer (spare seats)</p>
            <p className="text-xs text-muted-foreground">Spare seats per SKU NOT counted as reclaimable waste (kept for new hires). 0 = flag every unused seat.</p>
            <Input type="number" min={0} step={1} value={licBuffer}
              onChange={(e) => { setLicBuffer(e.target.value); setSaved(false); }}
              placeholder="0" className="h-8 w-28 bg-muted border-border text-foreground focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>

          <div className="flex items-center justify-end gap-4">
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

  // Hydrate persisted per-seat prices over the defaults.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.licensePrices) {
          setRows((prev) =>
            prev.map((row) => {
              const p = (d.licensePrices as Record<string, number>)[row.skuPartNumber];
              return p != null ? { ...row, pricePerUser: p } : row;
            })
          );
        }
      })
      .catch(() => {});
  }, []);

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
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold">
            Microsoft License Prices
          </CardTitle>
          <CardDescription>
            Microsoft Graph APIs do not expose contracted prices. Enter your
            actual per-user monthly prices (excl. VAT, EUR) here so the
            Licenses page can calculate accurate costs and wasted spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium w-48">
                    SKU Part Number
                  </TableHead>
                  <TableHead className="text-muted-foreground font-medium">
                    Display Name
                  </TableHead>
                  <TableHead className="text-muted-foreground font-medium w-44 text-right pr-6">
                    Price / User / Month (EUR)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-border hover:bg-accent"
                  >
                    <TableCell className="py-2">
                      <code className="text-xs text-primary bg-muted px-2 py-1 rounded font-mono">
                        {row.skuPartNumber}
                      </code>
                    </TableCell>
                    <TableCell className="py-2 text-sm text-foreground">
                      {row.displayName}
                    </TableCell>
                    <TableCell className="py-2 text-right pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-muted-foreground text-sm">€</span>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={row.pricePerUser}
                          onChange={(e) => updatePrice(row.id, e.target.value)}
                          className="h-8 w-24 bg-muted border-border text-foreground text-right focus:border-primary focus:ring-primary/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-md">
              Prices are stored on the server and applied to license cost/waste
              calculations. They are never sent to Microsoft.
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
      color: "text-primary",
      bg: "bg-primary/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* App info */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Database className="size-6 text-primary" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-foreground text-base font-semibold">
                IT Finance Dashboard
              </CardTitle>
              <CardDescription>
                Unified IT spend visibility across Business Central entities,
                Microsoft 365 licensing, and Azure cloud costs.
              </CardDescription>
              <Badge className="mt-1 bg-primary/15 text-primary border-primary/30 text-xs">
                v1.0.0
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tech stack */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <Code2 className="size-4 text-muted-foreground" />
            Technology Stack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {techStack.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 gap-4"
              >
                <span className="text-xs text-muted-foreground shrink-0">{label}</span>
                <span className="text-xs text-foreground font-medium text-right">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data sources */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            Data Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataSources.map(({ name, description, icon: Icon, color, bg }) => (
            <div
              key={name}
              className="flex items-start gap-3 rounded-lg bg-muted px-4 py-3"
            >
              <div
                className={`size-8 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}
              >
                <Icon className={`size-4 ${color}`} />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">{name}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Documentation links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-sm font-semibold flex items-center gap-2">
            <ExternalLink className="size-4 text-muted-foreground" />
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
              className="flex items-start justify-between rounded-lg bg-muted px-4 py-3 group hover:bg-accent transition-colors"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-primary group-hover:text-primary/80">
                  {label}
                </p>
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground shrink-0 mt-1" />
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
      <PageHeader
        title="Settings"
        description="Configure data sources, account mappings, and licence prices."
      />

      <Tabs defaultValue="general">
        <TabsList className="bg-muted border border-border h-auto p-1 gap-1 w-full sm:w-auto">
          <TabsTrigger
            value="general"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            General
          </TabsTrigger>
          <TabsTrigger
            value="gl-mapping"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            GL Mapping
          </TabsTrigger>
          <TabsTrigger
            value="budget"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            Budget
          </TabsTrigger>
          <TabsTrigger
            value="vendors"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            IT Vendors
          </TabsTrigger>
          <TabsTrigger
            value="operational"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            Operational SW
          </TabsTrigger>
          <TabsTrigger
            value="features"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            Features
          </TabsTrigger>
          <TabsTrigger
            value="license-prices"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            License Prices
          </TabsTrigger>
          <TabsTrigger
            value="about"
            className="text-muted-foreground data-active:bg-accent data-active:text-foreground px-4 py-1.5 text-sm rounded-md transition-colors"
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
          <TabsContent value="budget">
            <BudgetTab />
          </TabsContent>
          <TabsContent value="vendors">
            <VendorRulesTab />
          </TabsContent>
          <TabsContent value="operational">
            <OperationalSoftwareTab />
          </TabsContent>
          <TabsContent value="features">
            <FeaturesTab />
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
