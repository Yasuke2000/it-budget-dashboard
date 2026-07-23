"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle, XCircle, Pencil, Trash2 } from "lucide-react";
import { ExpiryBadge } from "./expiry-badge";
import { ContractDetailSheet } from "./contract-detail-sheet";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Contract } from "@/lib/types";

interface ContractTableProps {
  contracts: Contract[];
  onEdit?: (c: Contract) => void;
  onDelete?: (c: Contract) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  license: "License",
  domain: "Domain",
  ssl: "SSL",
  support: "Support",
  saas: "SaaS",
  infrastructure: "Infra",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-positive/10 text-positive border-positive/30",
  expiring_soon: "bg-warning/10 text-warning border-warning/30",
  expired: "bg-negative/10 text-negative border-negative/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export function ContractTable({ contracts, onEdit, onDelete }: ContractTableProps) {
  const showActions = Boolean(onEdit || onDelete);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  // Stable "now" captured once at mount — keeps the filter useMemo pure.
  const [now] = useState(() => Date.now());

  const filtered = useMemo(() => {
    let result = [...contracts];
    if (categoryFilter !== "all") result = result.filter((c) => c.category === categoryFilter);
    if (statusFilter !== "all") result = result.filter((c) => c.status === statusFilter);
    if (expiryFilter !== "all") {
      const days = parseInt(expiryFilter);
      result = result.filter((c) => {
        const daysLeft = (new Date(c.endDate).getTime() - now) / 86400000;
        return daysLeft > 0 && daysLeft <= days;
      });
    }
    // Sort by days left ascending
    return result.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [contracts, categoryFilter, statusFilter, expiryFilter, now]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-foreground">All Contracts</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={categoryFilter} onValueChange={(v) => { if (v !== null) setCategoryFilter(v); }}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="license">License</SelectItem>
                <SelectItem value="saas">SaaS</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="infrastructure">Infra</SelectItem>
                <SelectItem value="ssl">SSL</SelectItem>
                <SelectItem value="domain">Domain</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { if (v !== null) setStatusFilter(v); }}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expiring_soon">Expiring soon</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Select value={expiryFilter} onValueChange={(v) => { if (v !== null) setExpiryFilter(v); }}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Expiring within" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dates</SelectItem>
                <SelectItem value="30">Within 30 days</SelectItem>
                <SelectItem value="60">Within 60 days</SelectItem>
                <SelectItem value="90">Within 90 days</SelectItem>
                <SelectItem value="180">Within 180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Vendor</TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">Description</TableHead>
                <TableHead className="text-muted-foreground">Category</TableHead>
                <TableHead className="text-muted-foreground">End Date</TableHead>
                <TableHead className="text-muted-foreground">Days Left</TableHead>
                <TableHead className="text-muted-foreground text-right">Annual Cost</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground text-center">Auto</TableHead>
                {showActions && <TableHead className="text-muted-foreground text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="border-border hover:bg-accent cursor-pointer" onClick={() => setSelectedContract(c)}>
                  <TableCell className="text-foreground font-medium text-sm">{c.vendor}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate hidden lg:table-cell">{c.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs border-border text-foreground">
                      {CATEGORY_LABELS[c.category] || c.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-foreground text-sm font-mono tabular-nums">{formatDate(c.endDate)}</TableCell>
                  <TableCell><ExpiryBadge endDate={c.endDate} /></TableCell>
                  <TableCell className="text-right text-foreground font-mono tabular-nums text-sm">{formatCurrency(c.annualCost)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_STYLES[c.status] || ""}>
                      {c.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {c.autoRenew ? (
                      <CheckCircle className="h-4 w-4 text-positive mx-auto" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                    )}
                  </TableCell>
                  {showActions && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <button onClick={() => onEdit(c)} className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-accent" aria-label="Edit contract">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(c)} className="p-1.5 rounded text-muted-foreground hover:text-negative hover:bg-accent" aria-label="Delete contract">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showActions ? 9 : 8} className="text-center text-muted-foreground py-8">
                    No contracts match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <ContractDetailSheet
          contract={selectedContract}
          open={selectedContract !== null}
          onOpenChange={(open) => { if (!open) setSelectedContract(null); }}
        />
      </CardContent>
    </Card>
  );
}
