"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useDateRange } from "@/components/layout/date-range-context";
import { useCompany } from "@/components/layout/company-context";
import {
  LayoutDashboard,
  FileText,
  Key,
  PiggyBank,
  Building2,
  Monitor,
  Settings,
  Upload,
  Users,
  FileCheck,
  Lightbulb,
  Plug,
  ScrollText,
  FileDown,
  Download,
  SunMoon,
  GitBranch,
} from "lucide-react";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, href: "/" },
  { label: "Invoices", icon: FileText, href: "/invoices" },
  { label: "Licenses", icon: Key, href: "/licenses" },
  { label: "Budget", icon: PiggyBank, href: "/budget" },
  { label: "Vendors", icon: Building2, href: "/vendors" },
  { label: "Devices", icon: Monitor, href: "/devices" },
  { label: "Personnel", icon: Users, href: "/personnel" },
  { label: "Developers", icon: GitBranch, href: "/developers" },
  { label: "Import", icon: Upload, href: "/import" },
  { label: "Connectors", icon: Plug, href: "/connectors" },
  { label: "Insights", icon: Lightbulb, href: "/insights" },
  { label: "Contracts", icon: ScrollText, href: "/contracts" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

const PEPPOL_ITEM = { label: "Peppol", icon: FileCheck, href: "/peppol" };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { selectedRange } = useDateRange();
  const { selectedCompany } = useCompany();
  const [showPeppol, setShowPeppol] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setShowPeppol(Boolean(d?.showPeppol)))
      .catch(() => {});
  }, []);

  const items = showPeppol ? [...navItems.slice(0, 8), PEPPOL_ITEM, ...navItems.slice(8)] : navItems;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleNavigate(href: string) {
    router.push(href);
    setOpen(false);
  }

  // Rapport en export volgen dezelfde scope als het scherm (firmakiezer +
  // datumkiezer uit de gedeelde context). Voordien openden deze twee acties
  // /api/report en /api/export zónder parameters, waardoor je stil de laatste
  // 12 maanden van álle firma's kreeg in plaats van wat er op het scherm stond
  // (audit 05/08/2026).
  const scopeQs = `company=${encodeURIComponent(selectedCompany)}&dateFrom=${selectedRange.from}&dateTo=${selectedRange.to}`;

  function handleGenerateReport() {
    window.open(`/api/report?${scopeQs}`, "_blank");
    setOpen(false);
  }

  function handleExportData() {
    window.open(`/api/export?${scopeQs}`, "_blank");
    setOpen(false);
  }

  function handleToggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
    setOpen(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          {items.map(({ label, icon: Icon, href }) => (
            <CommandItem
              key={href}
              value={label}
              onSelect={() => handleNavigate(href)}
            >
              <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            value="Generate PDF Report"
            onSelect={handleGenerateReport}
          >
            <FileDown className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Generate PDF Report</span>
            <span className="ml-2 text-xs text-muted-foreground">{selectedRange.label}</span>
          </CommandItem>
          <CommandItem value="Export Data" onSelect={handleExportData}>
            <Download className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Export Data</span>
            <span className="ml-2 text-xs text-muted-foreground">{selectedRange.label}</span>
          </CommandItem>
          <CommandItem value="Toggle Theme" onSelect={handleToggleTheme}>
            <SunMoon className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Toggle Theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
