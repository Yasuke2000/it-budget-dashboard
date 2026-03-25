"use client";

import { useEffect, useRef, useState } from "react";
import {
  Shield,
  FileCheck,
  Upload,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  Link2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { PeppolInvoice, PeppolInvoiceLine } from "@/lib/peppol-parser";

// ─── Status helpers ────────────────────────────────────────────────────────────

type PeppolStatus = PeppolInvoice["status"];

function StatusBadge({ status }: { status: PeppolStatus }) {
  const cfg: Record<PeppolStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    received: {
      label: "Received",
      icon: <Clock className="h-3 w-3" />,
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    processed: {
      label: "Processed",
      icon: <CheckCircle2 className="h-3 w-3" />,
      cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    },
    matched: {
      label: "Matched",
      icon: <CheckCircle2 className="h-3 w-3" />,
      cls: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    },
    rejected: {
      label: "Rejected",
      icon: <XCircle className="h-3 w-3" />,
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
    },
  };

  const { label, icon, cls } = cfg[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        cls
      )}
    >
      {icon}
      {label}
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <div
          className={cn(
            "size-7 rounded-lg flex items-center justify-center shrink-0",
            highlight ? "bg-teal-500/20" : "bg-slate-800"
          )}
        >
          <Shield
            className={cn("h-4 w-4", highlight ? "text-teal-400" : "text-slate-500")}
          />
        </div>
        <span className="text-xs text-slate-400 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white leading-none">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({
  onParsed,
}: {
  onParsed: (invoice: PeppolInvoice) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function processFile(file: File) {
    if (!file.name.endsWith(".xml")) {
      setStatus("error");
      setMessage("Only .xml files are supported.");
      return;
    }
    setStatus("loading");
    setMessage("Parsing invoice…");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/peppol", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus("error");
        setMessage((body as { error?: string }).error ?? "Upload failed.");
        return;
      }
      const invoice = (await res.json()) as PeppolInvoice;
      setStatus("success");
      setMessage(`Parsed: ${invoice.invoiceNumber} — ${invoice.supplierName}`);
      onParsed(invoice);
    } catch {
      setStatus("error");
      setMessage("Network error — could not reach the server.");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 flex flex-col items-center gap-3 transition-colors",
        dragging
          ? "border-teal-400 bg-teal-500/10"
          : "border-slate-700 bg-slate-900 hover:border-slate-500 hover:bg-slate-800/50"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={handleChange}
      />
      <div className="size-10 rounded-lg bg-slate-800 flex items-center justify-center">
        <Upload className="h-5 w-5 text-slate-400" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-white">
          Drop a UBL XML file here or click to browse
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Peppol BIS Billing 3.0 · UBL 2.1 format
        </p>
      </div>

      {status !== "idle" && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "mt-2 rounded-lg border px-3 py-2 text-xs font-medium flex items-center gap-2",
            status === "loading" && "border-slate-700 bg-slate-800 text-slate-300",
            status === "success" && "border-teal-500/30 bg-teal-500/10 text-teal-400",
            status === "error" && "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          {status === "loading" && <Clock className="h-3.5 w-3.5 shrink-0" />}
          {status === "success" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {status === "error" && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          {message}
        </div>
      )}
    </div>
  );
}

// ─── Invoice row ──────────────────────────────────────────────────────────────

function InvoiceRow({ invoice }: { invoice: PeppolInvoice }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
        <td className="px-4 py-3 text-sm text-slate-300">
          {formatDate(invoice.issueDate)}
        </td>
        <td className="px-4 py-3">
          <span className="text-sm font-mono text-white">{invoice.invoiceNumber}</span>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm text-white">{invoice.supplierName}</p>
          {invoice.peppolId && (
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">{invoice.peppolId}</p>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-slate-400 font-mono">{invoice.supplierVAT}</td>
        <td className="px-4 py-3 text-sm text-right text-white font-semibold">
          {formatCurrency(invoice.totalInclVAT)}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={invoice.status} />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                // Stub — would open a match-to-BC dialog
                alert(`Match to BC: ${invoice.invoiceNumber} — integration not yet live.`);
              }}
              disabled={invoice.status === "matched"}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                invoice.status === "matched"
                  ? "border-slate-700 bg-slate-800/50 text-slate-600 cursor-not-allowed"
                  : "border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:border-teal-500/50"
              )}
            >
              <Link2 className="h-3 w-3" />
              Match to BC
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              Lines
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-800 bg-slate-900/60">
          <td colSpan={7} className="px-4 py-3">
            <LinesTable lines={invoice.lines} />
          </td>
        </tr>
      )}
    </>
  );
}

function LinesTable({ lines }: { lines: PeppolInvoiceLine[] }) {
  if (lines.length === 0) {
    return <p className="text-xs text-slate-500 italic">No line items.</p>;
  }
  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-slate-800">
          <tr>
            <th className="px-3 py-2 text-left text-slate-400 font-medium">Description</th>
            <th className="px-3 py-2 text-right text-slate-400 font-medium">Qty</th>
            <th className="px-3 py-2 text-right text-slate-400 font-medium">Unit Price</th>
            <th className="px-3 py-2 text-right text-slate-400 font-medium">VAT %</th>
            <th className="px-3 py-2 text-right text-slate-400 font-medium">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-t border-slate-700/50">
              <td className="px-3 py-2 text-slate-300">{line.description}</td>
              <td className="px-3 py-2 text-right text-slate-400">{line.quantity}</td>
              <td className="px-3 py-2 text-right text-slate-400">{formatCurrency(line.unitPrice)}</td>
              <td className="px-3 py-2 text-right text-slate-400">{line.vatPercent}%</td>
              <td className="px-3 py-2 text-right text-white font-medium">{formatCurrency(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PeppolPage() {
  const [invoices, setInvoices] = useState<PeppolInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/peppol")
      .then((r) => r.json())
      .then((data) => {
        setInvoices(data as PeppolInvoice[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleParsed(invoice: PeppolInvoice) {
    setInvoices((prev) => [invoice, ...prev]);
  }

  // Derived KPIs
  const total = invoices.length;
  const totalValue = invoices.reduce((s, i) => s + i.totalInclVAT, 0);
  const matched = invoices.filter((i) => i.status === "matched").length;
  const matchedPct = total > 0 ? Math.round((matched / total) * 100) : 0;
  const unprocessed = invoices.filter(
    (i) => i.status === "received" || i.status === "rejected"
  ).length;

  const isCompliant = total > 0;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Peppol E-Invoicing</h1>
          <p className="mt-1 text-slate-400">
            Belgian B2B mandate (since 1 Jan 2026) · Peppol BIS Billing 3.0 · UBL 2.1
          </p>
        </div>

        {/* Compliance badge */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
            isCompliant
              ? "border-teal-500/40 bg-teal-500/15 text-teal-400"
              : "border-amber-500/40 bg-amber-500/15 text-amber-400"
          )}
        >
          <FileCheck className="h-4 w-4" />
          {isCompliant ? "Peppol Active" : "Setup Required"}
        </span>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Peppol Invoices"
          value={loading ? "—" : String(total)}
          sub="All time"
          highlight
        />
        <KpiCard
          label="Total Value (incl. VAT)"
          value={loading ? "—" : formatCurrency(totalValue)}
          sub="Across all statuses"
        />
        <KpiCard
          label="Matched to BC"
          value={loading ? "—" : `${matchedPct}%`}
          sub={`${matched} of ${total} invoices`}
        />
        <KpiCard
          label="Unprocessed"
          value={loading ? "—" : String(unprocessed)}
          sub="Received or rejected"
        />
      </div>

      {/* ── Upload zone ── */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-2">Upload UBL XML Invoice</h2>
        <UploadZone onParsed={handleParsed} />
      </div>

      {/* ── Invoice table ── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-white">Peppol Invoices</h2>
          <span className="ml-auto text-xs text-slate-500">{total} invoice{total !== 1 ? "s" : ""}</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            No Peppol invoices yet. Upload a UBL XML file above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-800 bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Invoice #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">VAT #</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Amount (incl. VAT)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <InvoiceRow key={inv.id} invoice={inv} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Compliance info card ── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
            <Info className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Belgian Peppol Compliance</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Legal requirements for Belgian B2B e-invoicing via the Peppol network.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400 leading-relaxed">
          <div className="space-y-1">
            <p className="font-semibold text-white text-[13px]">Mandate</p>
            <p>
              Since <strong className="text-slate-300">1 January 2026</strong>, all Belgian
              B2B transactions must be invoiced electronically via the Peppol network
              (Royal Decree of 9 March 2025).
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-white text-[13px]">Penalties</p>
            <p>
              Non-compliance carries a penalty of{" "}
              <strong className="text-red-400">€1,500 per violation</strong>. Each
              invoice issued outside Peppol constitutes a separate violation.
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-white text-[13px]">Technical standard</p>
            <p>
              Invoices must conform to{" "}
              <strong className="text-slate-300">Peppol BIS Billing 3.0</strong> using
              UBL 2.1 XML. Exchange is done through a certified Peppol Access Point.
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-white text-[13px]">Participant ID</p>
            <p>
              Each company needs a Peppol participant ID in the format{" "}
              <code className="bg-slate-800 rounded px-1 text-teal-300">0208:&lt;VAT-number&gt;</code>{" "}
              (scheme 0208 = Belgian enterprise number).
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-white text-[13px]">Access Points</p>
            <p>
              Certified Belgian Access Points include Unifiedpost, Basware, Pagero,
              and Billit. Your ERP (Business Central) may offer native Peppol connectivity.
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-white text-[13px]">Retention</p>
            <p>
              E-invoices must be retained for{" "}
              <strong className="text-slate-300">7 years</strong> in their original UBL
              XML format, along with a human-readable PDF rendering.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
