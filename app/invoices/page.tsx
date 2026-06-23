import { getInvoices } from "@/lib/data-source";
import { InvoiceTable } from "@/components/invoices/invoice-table";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const invoices = await getInvoices(sp.company || "all", sp.from, sp.to);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Invoices</h1>
        <p className="text-slate-400">Purchase invoices across all entities</p>
      </div>
      <InvoiceTable invoices={invoices} />
    </div>
  );
}
