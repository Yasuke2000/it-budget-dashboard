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
} from "lucide-react";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, href: "/" },
  { label: "Invoices", icon: FileText, href: "/invoices" },
  { label: "Licenses", icon: Key, href: "/licenses" },
  { label: "Budget", icon: PiggyBank, href: "/budget" },
  { label: "Vendors", icon: Building2, href: "/vendors" },
  { label: "Devices", icon: Monitor, href: "/devices" },
  { label: "Personnel", icon: Users, href: "/personnel" },
  { label: "Import", icon: Upload, href: "/import" },
  { label: "Peppol", icon: FileCheck, href: "/peppol" },
  { label: "Connectors", icon: Plug, href: "/connectors" },
  { label: "Insights", icon: Lightbulb, href: "/insights" },
  { label: "Contracts", icon: ScrollText, href: "/contracts" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

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

  function handleGenerateReport() {
    window.open("/api/report", "_blank");
    setOpen(false);
  }

  function handleExportData() {
    window.open("/api/export", "_blank");
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
          {navItems.map(({ label, icon: Icon, href }) => (
            <CommandItem
              key={href}
              value={label}
              onSelect={() => handleNavigate(href)}
            >
              <Icon className="mr-2 h-4 w-4 text-slate-400" />
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
            <FileDown className="mr-2 h-4 w-4 text-slate-400" />
            <span>Generate PDF Report</span>
          </CommandItem>
          <CommandItem value="Export Data" onSelect={handleExportData}>
            <Download className="mr-2 h-4 w-4 text-slate-400" />
            <span>Export Data</span>
          </CommandItem>
          <CommandItem value="Toggle Theme" onSelect={handleToggleTheme}>
            <SunMoon className="mr-2 h-4 w-4 text-slate-400" />
            <span>Toggle Theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
