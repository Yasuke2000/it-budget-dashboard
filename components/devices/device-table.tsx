"use client";

import { useState, useMemo } from "react";
import {
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
  HelpCircle,
  Search,
} from "lucide-react";
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
import { cn, formatDate } from "@/lib/utils";
import type { ManagedDevice } from "@/lib/types";

interface DeviceTableProps {
  devices: ManagedDevice[];
}

const COMPLIANCE_BADGE: Record<
  ManagedDevice["complianceState"],
  { label: string; className: string }
> = {
  compliant: {
    label: "Compliant",
    className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border",
  },
  noncompliant: {
    label: "Non-compliant",
    className: "bg-red-500/20 text-red-400 border-red-500/30 border",
  },
  unknown: {
    label: "Unknown",
    className: "bg-slate-500/20 text-slate-400 border-slate-500/30 border",
  },
};

function DeviceTypeIcon({ type }: { type: ManagedDevice["chassisType"] }) {
  const cls = "h-4 w-4";
  switch (type) {
    case "laptop":
      return <Laptop className={cls} />;
    case "desktop":
      return <Monitor className={cls} />;
    case "phone":
      return <Smartphone className={cls} />;
    case "tablet":
      return <Tablet className={cls} />;
    default:
      return <HelpCircle className={cls} />;
  }
}

function DeviceTypeBadge({ type }: { type: ManagedDevice["chassisType"] }) {
  const labels: Record<ManagedDevice["chassisType"], string> = {
    laptop: "Laptop",
    desktop: "Desktop",
    phone: "Phone",
    tablet: "Tablet",
    unknown: "Unknown",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <DeviceTypeIcon type={type} />
      {labels[type]}
    </span>
  );
}

export function DeviceTable({ devices }: DeviceTableProps) {
  const [search, setSearch] = useState("");
  const [complianceFilter, setComplianceFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [manufacturerFilter, setManufacturerFilter] = useState<string>("all");

  const manufacturers = useMemo(
    () => Array.from(new Set(devices.map((d) => d.manufacturer).filter(Boolean))).sort(),
    [devices]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return devices.filter((d) => {
      if (q && !d.deviceName.toLowerCase().includes(q) &&
          !d.model.toLowerCase().includes(q) &&
          !d.assignedUser.toLowerCase().includes(q)) {
        return false;
      }
      if (complianceFilter !== "all" && d.complianceState !== complianceFilter) return false;
      if (typeFilter !== "all" && d.chassisType !== typeFilter) return false;
      if (manufacturerFilter !== "all" && d.manufacturer !== manufacturerFilter) return false;
      return true;
    });
  }, [devices, search, complianceFilter, typeFilter, manufacturerFilter]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search name, model, user…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 focus-visible:ring-teal-500"
          />
        </div>
        <Select value={complianceFilter} onValueChange={(v) => v && setComplianceFilter(v)}>
          <SelectTrigger className="w-[160px] bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="Compliance" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-300 focus:bg-slate-700">All compliance</SelectItem>
            <SelectItem value="compliant" className="text-emerald-400 focus:bg-slate-700">Compliant</SelectItem>
            <SelectItem value="noncompliant" className="text-red-400 focus:bg-slate-700">Non-compliant</SelectItem>
            <SelectItem value="unknown" className="text-slate-400 focus:bg-slate-700">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
          <SelectTrigger className="w-[140px] bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="Device type" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-300 focus:bg-slate-700">All types</SelectItem>
            <SelectItem value="laptop" className="text-slate-300 focus:bg-slate-700">Laptop</SelectItem>
            <SelectItem value="desktop" className="text-slate-300 focus:bg-slate-700">Desktop</SelectItem>
            <SelectItem value="phone" className="text-slate-300 focus:bg-slate-700">Phone</SelectItem>
            <SelectItem value="tablet" className="text-slate-300 focus:bg-slate-700">Tablet</SelectItem>
            <SelectItem value="unknown" className="text-slate-300 focus:bg-slate-700">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <Select value={manufacturerFilter} onValueChange={(v) => v && setManufacturerFilter(v)}>
          <SelectTrigger className="w-[160px] bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="Manufacturer" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-300 focus:bg-slate-700">All manufacturers</SelectItem>
            {manufacturers.map((m) => (
              <SelectItem key={m} value={m} className="text-slate-300 focus:bg-slate-700">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto self-center text-xs text-slate-500 tabular-nums">
          {filtered.length} of {devices.length} devices
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400 font-semibold pl-4">Device Name</TableHead>
              <TableHead className="text-slate-400 font-semibold">Model</TableHead>
              <TableHead className="text-slate-400 font-semibold">Manufacturer</TableHead>
              <TableHead className="text-slate-400 font-semibold">OS</TableHead>
              <TableHead className="text-slate-400 font-semibold">Enrolled</TableHead>
              <TableHead className="text-slate-400 font-semibold">Compliance</TableHead>
              <TableHead className="text-slate-400 font-semibold">Type</TableHead>
              <TableHead className="text-slate-400 font-semibold text-center">Age</TableHead>
              <TableHead className="text-slate-400 font-semibold pr-4">Assigned User</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableCell colSpan={9} className="text-center text-slate-600 py-12 text-sm">
                  No devices match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((device) => {
                const badge = COMPLIANCE_BADGE[device.complianceState];
                const isAged = device.ageYears > 4;
                return (
                  <TableRow
                    key={device.id}
                    className="border-slate-800/50 hover:bg-slate-800/30"
                  >
                    <TableCell className="pl-4 py-3">
                      <span className="text-sm font-medium text-white">
                        {device.deviceName}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-slate-300">
                      {device.model || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-400">
                      {device.manufacturer || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col leading-tight">
                        <span className="text-xs text-slate-300">{device.operatingSystem}</span>
                        <span className="text-[10px] text-slate-600">{device.osVersion}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-400 tabular-nums">
                      {device.enrolledDateTime
                        ? formatDate(device.enrolledDateTime.slice(0, 10))
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[11px]", badge.className)}>
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DeviceTypeBadge type={device.chassisType} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "text-xs font-mono font-semibold tabular-nums px-2 py-0.5 rounded",
                          isAged
                            ? "bg-red-500/20 text-red-400"
                            : device.ageYears > 3
                            ? "bg-amber-500/20 text-amber-400"
                            : "text-slate-400"
                        )}
                      >
                        {device.ageYears.toFixed(1)}y
                        {isAged && " ⚠"}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-sm text-slate-300">
                      {device.assignedUser || "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
