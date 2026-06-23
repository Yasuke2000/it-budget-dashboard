import Link from "next/link";
import { X } from "lucide-react";
import { getInvoices } from "@/lib/data-source";
import { InvoiceTable } from "@/components/invoices/invoice-table";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const company = sp.company || "all";
  let invoices = await getInvoices(company, sp.from, sp.to);

  // Drill-down filters (from KPI/category/vendor links).
  if (sp.category) invoices = invoices.filter((i) => i.costCategory === sp.category);
  if (sp.vendor) {
    const v = sp.vendor.toLowerCase();
    invoices = invoices.filter((i) => (i.vendorName || "").toLowerCase().includes(v));
  }

  // Build a "clear filter" link that keeps the company/date scope.
  const keep = new URLSearchParams();
  if (sp.company) keep.set("company", sp.company);
  if (sp.from) keep.set("from", sp.from);
  if (sp.to) keep.set("to", sp.to);
  const clearHref = keep.toString() ? `/invoices?${keep}` : "/invoices";
  const activeFilter = sp.category
    ? `Category: ${sp.category}`
    : sp.vendor
    ? `Vendor: ${sp.vendor}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Invoices</h1>
        <p className="text-slate-400">Purchase invoices across all entities</p>
      </div>

      {activeFilter && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-sm text-teal-300">
            {activeFilter}
            <Link href={clearHref} className="text-teal-400 hover:text-white" aria-label="Clear filter">
              <X className="h-3.5 w-3.5" />
            </Link>
          </span>
        </div>
      )}

      <InvoiceTable invoices={invoices} />
    </div>
  );
}
