"use client";

import { useState, useEffect } from "react";
import {
  Key,
  Building2,
  Users,
  Monitor,
  FileCheck,
  Upload,
  Plug,
  CheckCircle2,
  Circle,
  ExternalLink,
  X,
  ChevronRight,
  Globe,
  Smartphone,
  Signal,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorDef {
  id: string;
  name: string;
  icon: React.ElementType;
  iconColor: string;
  provides: string[];
  status: "connected" | "not_connected" | "partial";
  statusLabel?: string;
  setupContent: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Setup content blocks (static JSX, defined outside the component)
// ---------------------------------------------------------------------------

const M365SetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      This dashboard connects to Microsoft Graph API to pull license, device, and security data.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Sign-in method</p>
      <p className="text-foreground">
        If your organization uses <strong className="text-foreground">Entra ID (Azure AD)</strong>, you are
        likely already authenticated via SSO. The app just needs the following Graph API permissions
        added to the Enterprise App registration:
      </p>
      <ul className="mt-2 space-y-1 text-muted-foreground list-none">
        {[
          "LicenseAssignment.Read.All",
          "Directory.Read.All",
          "DeviceManagementManagedDevices.Read.All",
          "SecurityEvents.Read.All",
        ].map((perm) => (
          <li key={perm} className="flex items-center gap-2">
            <ChevronRight className="h-3 w-3 text-primary shrink-0" />
            <code className="font-mono text-xs text-foreground">{perm}</code>
          </li>
        ))}
      </ul>
    </div>
    <div className="bg-accent rounded-lg p-4 border border-primary/20">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Already signed in?</p>
      <p className="text-muted-foreground text-xs">
        If your admin login uses Entra ID SSO, set <code className="text-foreground">AZURE_AD_TENANT_ID</code>,{" "}
        <code className="text-foreground">AZURE_AD_CLIENT_ID</code>, and{" "}
        <code className="text-foreground">AZURE_AD_CLIENT_SECRET</code> in your{" "}
        <code className="text-foreground">.env.local</code>. The Graph client will use these automatically.
      </p>
    </div>
    <a
      href="https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors"
    >
      <ExternalLink className="h-3 w-3" /> Open Azure App Registrations
    </a>
  </div>
);

const BCSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Connect to Microsoft Dynamics 365 Business Central via the OData API to pull invoices, GL
      entries, budget, and chart of accounts.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "BC_ENVIRONMENT", example: "production" },
        { key: "BC_TENANT_ID", example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        { key: "BC_CLIENT_ID", example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        { key: "BC_CLIENT_SECRET", example: "your-client-secret" },
        { key: "BC_COMPANY_ID", example: "your-company-guid" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-foreground">{key}</code>
          <p className="text-xs text-muted-foreground">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
      <p className="text-xs text-warning">
        <strong>Need API access?</strong> Contact your Business Central partner — Alistar or Dynavision —
        to register an Azure App and obtain credentials.
      </p>
    </div>
  </div>
);

const OfficientSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Connect to Officient HR to sync employees, departments, salary data, and assigned assets.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "OFFICIENT_CLIENT_ID", example: "your-client-id" },
        { key: "OFFICIENT_CLIENT_SECRET", example: "your-client-secret" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-foreground">{key}</code>
          <p className="text-xs text-muted-foreground">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
      <p className="text-xs text-warning">
        <strong>Need credentials?</strong> Contact{" "}
        <a
          href="mailto:support@officient.io"
          className="underline hover:text-warning"
        >
          support@officient.io
        </a>{" "}
        to request API access for your organization.
      </p>
    </div>
  </div>
);

const DellSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Connect to Dell TechDirect to look up warranty status for Dell devices by serial number.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "DELL_CLIENT_ID", example: "your-client-id" },
        { key: "DELL_CLIENT_SECRET", example: "your-client-secret" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-foreground">{key}</code>
          <p className="text-xs text-muted-foreground">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Register your organization at Dell TechDirect to receive API credentials.
      </p>
      <a
        href="https://techdirect.dell.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors"
      >
        <ExternalLink className="h-3 w-3" /> Register at techdirect.dell.com
      </a>
    </div>
  </div>
);

const LenovoSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Connect to Lenovo eSupport API to look up warranty status for Lenovo and ThinkPad devices.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "LENOVO_CLIENT_ID", example: "your-client-id" },
        { key: "LENOVO_API_KEY", example: "your-api-key" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-foreground">{key}</code>
          <p className="text-xs text-muted-foreground">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
      <p className="text-xs text-warning">
        Contact your <strong>Lenovo account representative</strong> to request a Client ID for the
        eSupport Warranty API.
      </p>
    </div>
  </div>
);

const PeppolSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Receive electronic invoices (UBL XML) via the Peppol network. You need to register with a
      certified Peppol Access Point provider.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Belgian Peppol Access Points</p>
      {[
        { name: "Unifiedpost", url: "https://www.unifiedpost.com/peppol" },
        { name: "Billit", url: "https://www.billit.be" },
        { name: "Basware", url: "https://www.basware.com/peppol" },
        { name: "Isabel Group", url: "https://www.isabel.eu" },
      ].map(({ name, url }) => (
        <a
          key={name}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-foreground hover:text-foreground transition-colors py-0.5"
        >
          <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{name}</span>
          <ExternalLink className="h-3 w-3 text-muted-foreground/70 ml-auto" />
        </a>
      ))}
    </div>
    <p className="text-xs text-muted-foreground">
      Once registered, configure your Access Point credentials to deliver invoices to this application
      via the <code className="text-foreground">/api/peppol/inbound</code> webhook endpoint.
    </p>
  </div>
);

const CSVSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Import any data manually via CSV upload. Useful for one-off imports or data sources without
      a direct API integration.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Supported import types</p>
      <ul className="space-y-1">
        {[
          "Purchase Invoices",
          "GL Entries",
          "Budget Entries",
          "Employee data",
          "Device inventory",
        ].map((type) => (
          <li key={type} className="flex items-center gap-2 text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
            {type}
          </li>
        ))}
      </ul>
    </div>
    <a
      href="/import"
      className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors"
    >
      <Upload className="h-3 w-3" /> Go to Import page
    </a>
  </div>
);

const CitymeshSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Citymesh is a Belgian mobile and IoT connectivity provider (Roeselare). They offer mobile data
      plans, SIM management, and private 5G networks for businesses. There is no public billing API
      — billing data is available via CSV export or monthly PDF invoices from the Citymesh portal.
    </p>
    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
      <p className="text-xs text-indigo-300">
        <strong>No public API.</strong> Belgian mobile provider — use CSV export or PDF invoice
        parsing to import billing data.
      </p>
    </div>
    <div className="bg-muted rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">How to import</p>
      <ol className="space-y-2 text-muted-foreground text-xs list-none">
        {[
          "Sign in to the Citymesh portal at my.citymesh.com",
          "Navigate to Billing → Usage Reports",
          "Export your monthly usage report as CSV",
          "Upload the CSV via the /import page of this dashboard",
          'Costs will be categorised as "Telecom" automatically',
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-[10px] mt-0.5">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
    <div className="bg-accent rounded-lg p-4 border border-border space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Dashboard category
      </p>
      <p className="text-xs text-foreground">
        Imported Citymesh costs are tagged as{" "}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300">
          Telecom
        </span>{" "}
        and visible in the Budget and Invoices views.
      </p>
    </div>
    <div className="flex flex-col gap-2">
      <a
        href="https://my.citymesh.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors"
      >
        <ExternalLink className="h-3 w-3" /> Open Citymesh portal (my.citymesh.com)
      </a>
      <a
        href="/import"
        className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors"
      >
        <Upload className="h-3 w-3" /> Go to Import page to upload CSV
      </a>
    </div>
  </div>
);

const KnoxSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-foreground">
      Connect to Samsung Knox to pull Samsung device inventory, battery health, compliance status,
      MDM enrollment, and Knox license usage.
    </p>
    <div className="bg-muted rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "KNOX_CLIENT_ID", example: "your-knox-client-id" },
        { key: "KNOX_CLIENT_SECRET", example: "your-knox-client-secret" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-foreground">{key}</code>
          <p className="text-xs text-muted-foreground">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-accent rounded-lg p-4 border border-primary/20">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Setup steps</p>
      <ol className="mt-1 space-y-1 text-muted-foreground text-xs list-none">
        {[
          "Sign in to the Samsung Knox Admin Portal",
          "Go to API credentials and create a new client application",
          "Copy the Client ID and Client Secret into your .env.local",
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
      <p className="text-xs text-blue-300">
        <strong>EU data center:</strong> This integration uses{" "}
        <code className="text-blue-200">eu-kcs-api.samsungknox.com</code> for GDPR compliance.
      </p>
    </div>
    <a
      href="https://www.samsungknox.com/en/knox-admin-portal"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors"
    >
      <ExternalLink className="h-3 w-3" /> Open Samsung Knox Admin Portal
    </a>
  </div>
);

// ---------------------------------------------------------------------------
// Connector definitions
// ---------------------------------------------------------------------------

const CONNECTORS: ConnectorDef[] = [
  {
    id: "m365",
    name: "Microsoft 365",
    icon: Key,
    iconColor: "text-blue-400",
    provides: ["Licenses", "Users", "Devices (Intune)", "Secure Score"],
    status: "not_connected",
    setupContent: M365SetupContent,
  },
  {
    id: "business-central",
    name: "Business Central",
    icon: Building2,
    iconColor: "text-positive",
    provides: ["Invoices", "GL Entries", "Budget", "Chart of Accounts"],
    status: "not_connected",
    setupContent: BCSetupContent,
  },
  {
    id: "officient",
    name: "Officient HR",
    icon: Users,
    iconColor: "text-purple-400",
    provides: ["Employees", "Departments", "Salaries", "Assets"],
    status: "not_connected",
    setupContent: OfficientSetupContent,
  },
  {
    id: "dell",
    name: "Dell TechDirect",
    icon: Monitor,
    iconColor: "text-sky-400",
    provides: ["Warranty Status (Dell)"],
    status: "not_connected",
    setupContent: DellSetupContent,
  },
  {
    id: "lenovo",
    name: "Lenovo eSupport",
    icon: Monitor,
    iconColor: "text-negative",
    provides: ["Warranty Status (Lenovo / ThinkPad)"],
    status: "not_connected",
    setupContent: LenovoSetupContent,
  },
  {
    id: "peppol",
    name: "Peppol (e-Invoicing)",
    icon: FileCheck,
    iconColor: "text-primary",
    provides: ["Electronic Invoices (UBL XML)", "Peppol Network"],
    status: "not_connected",
    setupContent: PeppolSetupContent,
  },
  {
    id: "citymesh",
    name: "Citymesh",
    icon: Signal,
    iconColor: "text-indigo-400",
    provides: ["Mobile data usage", "SIM management", "Monthly billing"],
    status: "not_connected",
    statusLabel: "Manual Import",
    setupContent: CitymeshSetupContent,
  },
  {
    id: "samsung-knox",
    name: "Samsung Knox",
    icon: Smartphone,
    iconColor: "text-blue-400",
    provides: [
      "Samsung device inventory",
      "Battery health",
      "Compliance status",
      "MDM enrollment",
      "Knox licenses",
    ],
    status: "not_connected",
    setupContent: KnoxSetupContent,
  },
  {
    id: "csv",
    name: "CSV Import",
    icon: Upload,
    iconColor: "text-warning",
    provides: ["Any data via manual CSV upload"],
    status: "not_connected",
    statusLabel: "Manual",
    setupContent: CSVSetupContent,
  },
];

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status, label }: { status: ConnectorDef["status"]; label?: string }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-positive">
        <span className="w-1.5 h-1.5 rounded-full bg-positive shrink-0" />
        Connected
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
        <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
        {label ?? "Partial"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted shrink-0" />
      {label ?? "Not Connected"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dialog / modal
// ---------------------------------------------------------------------------

interface ConnectorDialogProps {
  connector: ConnectorDef;
  onClose: () => void;
}

function ConnectorDialog({ connector, onClose }: ConnectorDialogProps) {
  const Icon = connector.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${connector.name} setup`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Icon className={cn("h-5 w-5", connector.iconColor)} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{connector.name}</h2>
              <StatusBadge status={connector.status} label={connector.statusLabel} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* What it provides */}
        <div className="px-6 pt-4 pb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Provides
          </p>
          <div className="flex flex-wrap gap-1.5">
            {connector.provides.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 text-xs bg-muted text-foreground px-2 py-0.5 rounded-full border border-border"
              >
                <CheckCircle2 className="h-3 w-3 text-primary" />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Setup instructions */}
        <div className="px-6 py-4">{connector.setupContent}</div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector card
// ---------------------------------------------------------------------------

interface ConnectorCardProps {
  connector: ConnectorDef;
  onConnect: () => void;
}

function ConnectorCard({ connector, onConnect }: ConnectorCardProps) {
  const Icon = connector.icon;

  return (
    <Card className="hover:border-border-strong transition-colors flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
              <Icon className={cn("h-5 w-5", connector.iconColor)} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-foreground leading-tight">
                {connector.name}
              </CardTitle>
              <div className="mt-0.5">
                <StatusBadge status={connector.status} label={connector.statusLabel} />
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col flex-1 pt-0 gap-4">
        {/* What it provides */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1.5">
            Provides
          </p>
          <ul className="space-y-0.5">
            {connector.provides.map((item) => (
              <li key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Circle className="h-1 w-1 fill-muted-foreground/70 text-muted-foreground/70 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Connect button */}
        <div className="mt-auto">
          <Button
            size="sm"
            variant="outline"
            className="w-full border-border bg-accent text-foreground hover:bg-accent hover:text-foreground hover:border-primary/50 transition-all"
            onClick={onConnect}
          >
            {connector.status === "connected" ? "Manage" : "Connect"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// Maps a connector id to the service key reported by /api/status.
const STATUS_KEY: Record<string, string> = {
  m365: "graph",
  "business-central": "bc",
  officient: "officient",
  dell: "dell",
  lenovo: "lenovo",
};

interface StatusResponse {
  demoMode: boolean;
  services: Record<string, { configured: boolean; connected: boolean; error: string | null }>;
}

export default function ConnectorsPage() {
  const [activeConnector, setActiveConnector] = useState<ConnectorDef | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => r.json())
      .then((d: StatusResponse) => { if (!cancelled) setStatus(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Overlay live status onto the static connector definitions.
  const connectors: ConnectorDef[] = CONNECTORS.map((c) => {
    const svc = status?.services?.[STATUS_KEY[c.id] ?? ""];
    if (!svc) return c; // CSV / Citymesh / Peppol / Knox have no auto-detected status
    if (svc.connected) return { ...c, status: "connected" as const };
    if (svc.configured) return { ...c, status: "partial" as const, statusLabel: "Configured — check permissions" };
    return { ...c, status: "not_connected" as const };
  });

  const connectedCount = connectors.filter((c) => c.status === "connected").length;
  const demoMode = status?.demoMode ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Connectors"
        description="Connect your data sources — no manual .env editing required"
      />

      {/* Summary bar */}
      <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{connectedCount}</span> of{" "}
            <span className="font-semibold text-foreground">{connectors.length}</span> connectors active
          </span>
        </div>
        {demoMode && (
          <Badge
            variant="outline"
            className="border-warning/40 bg-warning/10 text-warning text-[10px] font-semibold tracking-wider uppercase"
          >
            Demo Mode — sample data only
          </Badge>
        )}
      </div>

      {/* Connector grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {connectors.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            onConnect={() => setActiveConnector(connector)}
          />
        ))}
      </div>

      {/* Dialog */}
      {activeConnector && (
        <ConnectorDialog
          connector={activeConnector}
          onClose={() => setActiveConnector(null)}
        />
      )}
    </div>
  );
}
