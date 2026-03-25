"use client";

import { useState } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    <p className="text-slate-300">
      This dashboard connects to Microsoft Graph API to pull license, device, and security data.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Sign-in method</p>
      <p className="text-slate-300">
        If your organization uses <strong className="text-white">Entra ID (Azure AD)</strong>, you are
        likely already authenticated via SSO. The app just needs the following Graph API permissions
        added to the Enterprise App registration:
      </p>
      <ul className="mt-2 space-y-1 text-slate-400 list-none">
        {[
          "LicenseAssignment.Read.All",
          "Directory.Read.All",
          "DeviceManagementManagedDevices.Read.All",
          "SecurityEvents.Read.All",
        ].map((perm) => (
          <li key={perm} className="flex items-center gap-2">
            <ChevronRight className="h-3 w-3 text-teal-500 shrink-0" />
            <code className="font-mono text-xs text-slate-200">{perm}</code>
          </li>
        ))}
      </ul>
    </div>
    <div className="bg-slate-800/60 rounded-lg p-4 border border-teal-500/20">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-1">Already signed in?</p>
      <p className="text-slate-400 text-xs">
        If your admin login uses Entra ID SSO, set <code className="text-slate-200">AZURE_AD_TENANT_ID</code>,{" "}
        <code className="text-slate-200">AZURE_AD_CLIENT_ID</code>, and{" "}
        <code className="text-slate-200">AZURE_AD_CLIENT_SECRET</code> in your{" "}
        <code className="text-slate-200">.env.local</code>. The Graph client will use these automatically.
      </p>
    </div>
    <a
      href="https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 text-xs transition-colors"
    >
      <ExternalLink className="h-3 w-3" /> Open Azure App Registrations
    </a>
  </div>
);

const BCSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Connect to Microsoft Dynamics 365 Business Central via the OData API to pull invoices, GL
      entries, budget, and chart of accounts.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "BC_ENVIRONMENT", example: "production" },
        { key: "BC_TENANT_ID", example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        { key: "BC_CLIENT_ID", example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        { key: "BC_CLIENT_SECRET", example: "your-client-secret" },
        { key: "BC_COMPANY_ID", example: "your-company-guid" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-slate-200">{key}</code>
          <p className="text-xs text-slate-500">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
      <p className="text-xs text-amber-300">
        <strong>Need API access?</strong> Contact your Business Central partner — Alistar or Dynavision —
        to register an Azure App and obtain credentials.
      </p>
    </div>
  </div>
);

const JiraSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Connect to Jira Cloud to pull worklogs, time tracking entries, and calculate project labor costs.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "JIRA_BASE_URL", example: "https://your-org.atlassian.net" },
        { key: "JIRA_EMAIL", example: "admin@your-org.com" },
        { key: "JIRA_API_TOKEN", example: "your-api-token" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-slate-200">{key}</code>
          <p className="text-xs text-slate-500">e.g. {example}</p>
        </div>
      ))}
    </div>
    <a
      href="https://id.atlassian.com/manage-profile/security/api-tokens"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 text-xs transition-colors"
    >
      <ExternalLink className="h-3 w-3" /> Generate API token at id.atlassian.com
    </a>
  </div>
);

const OfficientSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Connect to Officient HR to sync employees, departments, salary data, and assigned assets.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "OFFICIENT_CLIENT_ID", example: "your-client-id" },
        { key: "OFFICIENT_CLIENT_SECRET", example: "your-client-secret" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-slate-200">{key}</code>
          <p className="text-xs text-slate-500">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
      <p className="text-xs text-amber-300">
        <strong>Need credentials?</strong> Contact{" "}
        <a
          href="mailto:support@officient.io"
          className="underline hover:text-amber-200"
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
    <p className="text-slate-300">
      Connect to Dell TechDirect to look up warranty status for Dell devices by serial number.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "DELL_CLIENT_ID", example: "your-client-id" },
        { key: "DELL_CLIENT_SECRET", example: "your-client-secret" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-slate-200">{key}</code>
          <p className="text-xs text-slate-500">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Register your organization at Dell TechDirect to receive API credentials.
      </p>
      <a
        href="https://techdirect.dell.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 text-xs transition-colors"
      >
        <ExternalLink className="h-3 w-3" /> Register at techdirect.dell.com
      </a>
    </div>
  </div>
);

const LenovoSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Connect to Lenovo eSupport API to look up warranty status for Lenovo and ThinkPad devices.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "LENOVO_CLIENT_ID", example: "your-client-id" },
        { key: "LENOVO_API_KEY", example: "your-api-key" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-slate-200">{key}</code>
          <p className="text-xs text-slate-500">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
      <p className="text-xs text-amber-300">
        Contact your <strong>Lenovo account representative</strong> to request a Client ID for the
        eSupport Warranty API.
      </p>
    </div>
  </div>
);

const PeppolSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Receive electronic invoices (UBL XML) via the Peppol network. You need to register with a
      certified Peppol Access Point provider.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Belgian Peppol Access Points</p>
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
          className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors py-0.5"
        >
          <Globe className="h-3.5 w-3.5 text-teal-500 shrink-0" />
          <span>{name}</span>
          <ExternalLink className="h-3 w-3 text-slate-600 ml-auto" />
        </a>
      ))}
    </div>
    <p className="text-xs text-slate-500">
      Once registered, configure your Access Point credentials to deliver invoices to this application
      via the <code className="text-slate-300">/api/peppol/inbound</code> webhook endpoint.
    </p>
  </div>
);

const CSVSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Import any data manually via CSV upload. Useful for one-off imports or data sources without
      a direct API integration.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-2">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Supported import types</p>
      <ul className="space-y-1">
        {[
          "Purchase Invoices",
          "GL Entries",
          "Budget Entries",
          "Employee data",
          "Device inventory",
        ].map((type) => (
          <li key={type} className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="h-3.5 w-3.5 text-teal-500 shrink-0" />
            {type}
          </li>
        ))}
      </ul>
    </div>
    <a
      href="/import"
      className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 text-xs transition-colors"
    >
      <Upload className="h-3 w-3" /> Go to Import page
    </a>
  </div>
);

const KnoxSetupContent = (
  <div className="space-y-4 text-sm">
    <p className="text-slate-300">
      Connect to Samsung Knox to pull Samsung device inventory, battery health, compliance status,
      MDM enrollment, and Knox license usage.
    </p>
    <div className="bg-slate-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Required .env variables</p>
      {[
        { key: "KNOX_CLIENT_ID", example: "your-knox-client-id" },
        { key: "KNOX_CLIENT_SECRET", example: "your-knox-client-secret" },
      ].map(({ key, example }) => (
        <div key={key}>
          <code className="text-xs font-mono text-slate-200">{key}</code>
          <p className="text-xs text-slate-500">e.g. {example}</p>
        </div>
      ))}
    </div>
    <div className="bg-slate-800/60 rounded-lg p-4 border border-teal-500/20">
      <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-1">Setup steps</p>
      <ol className="mt-1 space-y-1 text-slate-400 text-xs list-none">
        {[
          "Sign in to the Samsung Knox Admin Portal",
          "Go to API credentials and create a new client application",
          "Copy the Client ID and Client Secret into your .env.local",
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <ChevronRight className="h-3 w-3 text-teal-500 shrink-0 mt-0.5" />
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
      className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 text-xs transition-colors"
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
    iconColor: "text-emerald-400",
    provides: ["Invoices", "GL Entries", "Budget", "Chart of Accounts"],
    status: "not_connected",
    setupContent: BCSetupContent,
  },
  {
    id: "jira",
    name: "Jira Cloud",
    icon: Plug,
    iconColor: "text-blue-500",
    provides: ["Worklogs", "Time Tracking", "Project Costs"],
    status: "not_connected",
    setupContent: JiraSetupContent,
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
    iconColor: "text-red-400",
    provides: ["Warranty Status (Lenovo / ThinkPad)"],
    status: "not_connected",
    setupContent: LenovoSetupContent,
  },
  {
    id: "peppol",
    name: "Peppol (e-Invoicing)",
    icon: FileCheck,
    iconColor: "text-teal-400",
    provides: ["Electronic Invoices (UBL XML)", "Peppol Network"],
    status: "not_connected",
    setupContent: PeppolSetupContent,
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
    iconColor: "text-amber-400",
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
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        Connected
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        {label ?? "Partial"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
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
        className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
              <Icon className={cn("h-5 w-5", connector.iconColor)} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{connector.name}</h2>
              <StatusBadge status={connector.status} label={connector.statusLabel} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors mt-0.5"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* What it provides */}
        <div className="px-6 pt-4 pb-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Provides
          </p>
          <div className="flex flex-wrap gap-1.5">
            {connector.provides.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700"
              >
                <CheckCircle2 className="h-3 w-3 text-teal-500" />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Setup instructions */}
        <div className="px-6 py-4">{connector.setupContent}</div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
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
    <Card className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 shrink-0">
              <Icon className={cn("h-5 w-5", connector.iconColor)} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-white leading-tight">
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
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Provides
          </p>
          <ul className="space-y-0.5">
            {connector.provides.map((item) => (
              <li key={item} className="flex items-center gap-1.5 text-xs text-slate-400">
                <Circle className="h-1 w-1 fill-slate-600 text-slate-600 shrink-0" />
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
            className="w-full border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white hover:border-teal-500/50 transition-all"
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

export default function ConnectorsPage() {
  const [activeConnector, setActiveConnector] = useState<ConnectorDef | null>(null);

  const connectedCount = CONNECTORS.filter((c) => c.status === "connected").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Connectors</h1>
        <p className="text-slate-400">
          Connect your data sources — no manual .env editing required
        </p>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 p-4 bg-slate-900 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-slate-500" />
          <span className="text-sm text-slate-400">
            <span className="font-semibold text-white">{connectedCount}</span> of{" "}
            <span className="font-semibold text-white">{CONNECTORS.length}</span> connectors active
          </span>
        </div>
        {connectedCount === 0 && (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px] font-semibold tracking-wider uppercase"
          >
            Demo Mode — sample data only
          </Badge>
        )}
      </div>

      {/* Connector grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {CONNECTORS.map((connector) => (
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
