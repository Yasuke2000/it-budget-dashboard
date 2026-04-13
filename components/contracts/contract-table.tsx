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
import { CheckCircle, XCircle } from "lucide-react";
import { ExpiryBadge } from "./expiry-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Contract } from "@/lib/types";

interface ContractTableProps {
  contracts: Contract[];
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
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  expiring_soon: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  expired: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export function ContractTable({ contracts }: ContractTableProps) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");

  const filtered = useMemo(() => {
    let result = [...contracts];
    if (categoryFilter !== "all") result = result.filter((c) => c.category === categoryFilter);
    if (statusFilter !== "all") result = result.filter((c) => c.status === statusFilter);
    if (expiryFilter !== "all") {
      const days = parseInt(expiryFilter);
      const now = Date.now();
      result = result.filter((c) => {
        const daysLeft = (new Date(c.endDate).getTime() - now) / 86400000;
        return daysLeft > 0 && daysLeft <= days;
      });
    }
    // Sort by days left ascending
    return result.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [contracts, categoryFilter, statusFilter, expiryFilter]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-white">All Contracts</CardTitle>
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
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Vendor</TableHead>
                <TableHead className="text-slate-400 hidden lg:table-cell">Description</TableHead>
                <TableHead className="text-slate-400">Category</TableHead>
                <TableHead className="text-slate-400">End Date</TableHead>
                <TableHead className="text-slate-400">Days Left</TableHead>
                <TableHead className="text-slate-400 text-right">Annual Cost</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400 text-center">Auto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell className="text-white font-medium text-sm">{c.vendor}</TableCell>
                  <TableCell className="text-slate-400 text-xs max-w-[200px] truncate hidden lg:table-cell">{c.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs border-slate-700 text-slate-300">
                      {CATEGORY_LABELS[c.category] || c.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm font-mono tabular-nums">{formatDate(c.endDate)}</TableCell>
                  <TableCell><ExpiryBadge endDate={c.endDate} /></TableCell>
                  <TableCell className="text-right text-slate-300 font-mono tabular-nums text-sm">{formatCurrency(c.annualCost)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_STYLES[c.status] || ""}>
                      {c.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {c.autoRenew ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="h-4 w-4 text-slate-500 mx-auto" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-500 py-8">
                    No contracts match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
