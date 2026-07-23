"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { PurchaseInvoice } from "@/lib/types";
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

const PAGE_SIZE = 20;

type SortField = "invoiceDate" | "totalAmountExcludingTax";
type SortDir = "asc" | "desc";

function statusBadge(status: PurchaseInvoice["status"]) {
  const map: Record<
    PurchaseInvoice["status"],
    { label: string; className: string }
  > = {
    Paid: {
      label: "Paid",
      className: "bg-positive/15 text-positive border-positive/30",
    },
    Open: {
      label: "Open",
      className: "bg-warning/15 text-warning border-warning/30",
    },
    Canceled: {
      label: "Canceled",
      className: "bg-negative/15 text-negative border-negative/30",
    },
    Draft: {
      label: "Draft",
      className: "bg-muted text-muted-foreground border-border",
    },
  };
  const cfg = map[status] ?? map.Draft;
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium border", cfg.className)}
    >
      {cfg.label}
    </Badge>
  );
}

function SortIcon({
  field,
  active,
  dir,
}: {
  field: string;
  active: string;
  dir: SortDir;
}) {
  if (field !== active)
    return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground inline" />;
  return dir === "asc" ? (
    <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary inline" />
  ) : (
    <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary inline" />
  );
}

function exportToCSV(invoices: PurchaseInvoice[]) {
  const headers = [
    "Date",
    "Invoice #",
    "Vendor",
    "Category",
    "Entity",
    "Amount (excl. tax)",
    "Status",
  ];
  const rows = invoices.map((inv) => [
    inv.invoiceDate,
    inv.number,
    `"${inv.vendorName.replace(/"/g, '""')}"`,
    `"${inv.costCategory.replace(/"/g, '""')}"`,
    inv.companyName,
    inv.totalAmountExcludingTax.toFixed(2),
    inv.status,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "invoices.csv";
  a.click();
  URL.revokeObjectURL(url);
}

interface InvoiceTableProps {
  invoices: PurchaseInvoice[];
}

export function InvoiceTable({ invoices }: InvoiceTableProps) {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("invoiceDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  // Derive unique categories for filter dropdown
  const categories = useMemo(() => {
    const set = new Set(invoices.map((inv) => inv.costCategory));
    return Array.from(set).sort();
  }, [invoices]);

  const entities = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((inv) => map.set(inv.companyId, inv.companyName));
    return Array.from(map.entries());
  }, [invoices]);

  // Distinct statuses actually present. In live mode every invoice is "Paid"
  // (built from posted GL entries), so the status filter would do nothing — only
  // show it when there's genuinely more than one status to filter by.
  const statuses = useMemo(
    () => Array.from(new Set(invoices.map((inv) => inv.status))).sort(),
    [invoices]
  );
  const showStatusFilter = statuses.length > 1;

  const filtered = useMemo(() => {
    let result = invoices;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (inv) =>
          inv.vendorName.toLowerCase().includes(q) ||
          inv.number.toLowerCase().includes(q)
      );
    }
    if (entityFilter !== "all") {
      result = result.filter((inv) => inv.companyId === entityFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((inv) => inv.status === statusFilter);
    }
    if (categoryFilter !== "all") {
      result = result.filter((inv) => inv.costCategory === categoryFilter);
    }
    if (dateFrom) {
      result = result.filter((inv) => inv.invoiceDate >= dateFrom);
    }
    if (dateTo) {
      result = result.filter((inv) => inv.invoiceDate <= dateTo);
    }

    return result;
  }, [
    invoices,
    search,
    entityFilter,
    statusFilter,
    categoryFilter,
    dateFrom,
    dateTo,
  ]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "invoiceDate") {
        cmp = a.invoiceDate.localeCompare(b.invoiceDate);
      } else {
        cmp = a.totalAmountExcludingTax - b.totalAmountExcludingTax;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const displayTotal = filtered.reduce(
    (s, inv) => s + inv.totalAmountExcludingTax,
    0
  );

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  function handleFilterChange(setter: (v: string) => void) {
    return (v: string | null) => {
      if (v !== null) setter(v);
      setPage(1);
    };
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-foreground">
            Purchase Invoices
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {filtered.length} of {invoices.length} results
            </span>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToCSV(sorted)}
            className="bg-muted border-border text-foreground hover:bg-accent hover:text-foreground w-fit"
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pt-2">
          {/* Search */}
          <div className="relative sm:col-span-2 xl:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search vendor or invoice #..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary"
            />
          </div>

          {/* Entity */}
          <Select
            value={entityFilter}
            onValueChange={handleFilterChange(setEntityFilter)}
          >
            <SelectTrigger className="bg-muted border-border text-foreground focus:ring-primary">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent className="bg-muted border-border">
              <SelectItem value="all" className="text-foreground">
                All Entities
              </SelectItem>
              {entities.map(([id, name]) => (
                <SelectItem key={id} value={id} className="text-foreground">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status — only when the data has more than one status (hidden in live
              mode where everything is "Paid"). Options built from real data. */}
          {showStatusFilter && (
            <Select
              value={statusFilter}
              onValueChange={handleFilterChange(setStatusFilter)}
            >
              <SelectTrigger className="bg-muted border-border text-foreground focus:ring-primary">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                <SelectItem value="all" className="text-foreground">
                  All Statuses
                </SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s} className="text-foreground">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Category */}
          <Select
            value={categoryFilter}
            onValueChange={handleFilterChange(setCategoryFilter)}
          >
            <SelectTrigger className="bg-muted border-border text-foreground focus:ring-primary">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent className="bg-muted border-border">
              <SelectItem value="all" className="text-foreground">
                All Categories
              </SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat} className="text-foreground">
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range */}
          <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-1">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="bg-muted border-border text-foreground focus-visible:ring-primary [color-scheme:dark]"
              aria-label="Date from"
            />
            <span className="text-muted-foreground text-sm shrink-0">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="bg-muted border-border text-foreground focus-visible:ring-primary [color-scheme:dark]"
              aria-label="Date to"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead
                  className="text-muted-foreground cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort("invoiceDate")}
                >
                  Date
                  <SortIcon
                    field="invoiceDate"
                    active={sortField}
                    dir={sortDir}
                  />
                </TableHead>
                <TableHead className="text-muted-foreground whitespace-nowrap">
                  Invoice #
                </TableHead>
                <TableHead className="text-muted-foreground">Vendor</TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  Category
                </TableHead>
                <TableHead className="text-muted-foreground hidden md:table-cell">
                  Entity
                </TableHead>
                <TableHead
                  className="text-muted-foreground text-right cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort("totalAmountExcludingTax")}
                >
                  Amount (excl. tax)
                  <SortIcon
                    field="totalAmountExcludingTax"
                    active={sortField}
                    dir={sortDir}
                  />
                </TableHead>
                <TableHead className="text-muted-foreground text-center">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No invoices match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="border-border hover:bg-accent transition-colors"
                  >
                    <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                      {formatDate(inv.invoiceDate)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-foreground whitespace-nowrap">
                      {inv.number}
                    </TableCell>
                    <TableCell className="text-foreground font-medium max-w-[200px] truncate">
                      {inv.vendorName}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm hidden lg:table-cell max-w-[160px] truncate">
                      {inv.costCategory}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge
                        variant="secondary"
                        className="bg-muted text-muted-foreground text-xs border-border"
                      >
                        {inv.companyName}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground whitespace-nowrap">
                      {formatCurrency(inv.totalAmountExcludingTax)}
                    </TableCell>
                    <TableCell className="text-center">
                      {statusBadge(inv.status)}
                    </TableCell>
                  </TableRow>
                ))
              )}

              {/* Totals row */}
              {filtered.length > 0 && (
                <TableRow className="border-border bg-accent">
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground text-sm font-medium py-3 pl-4"
                  >
                    Total ({filtered.length} invoices)
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-foreground whitespace-nowrap py-3">
                    {formatCurrency(displayTotal)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="text-foreground">
                {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, sorted.length)}
              </span>{" "}
              of <span className="text-foreground">{sorted.length}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="bg-muted border-border text-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                Page {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="bg-muted border-border text-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
