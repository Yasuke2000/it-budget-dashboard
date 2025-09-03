import { getInvoices } from "@/lib/data-source";
import { InvoiceTable } from "@/components/invoices/invoice-table";

export default async function InvoicesPage() {
  const invoices = await getInvoices();
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
