"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSidebarTrigger } from "@/components/layout/sidebar";
import { useCompany } from "@/components/layout/company-context";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/invoices": "Invoices",
  "/licenses": "Licenses",
  "/budget": "Budget",
  "/vendors": "Vendors",
  "/devices": "Devices",
  "/settings": "Settings",
};

const COMPANIES = [
  { value: "all", label: "All Companies" },
  { value: "GDI", label: "GDI" },
  { value: "WHS", label: "WHS" },
  { value: "GRE", label: "GRE" },
  { value: "TDR", label: "TDR" },
];

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const match = Object.keys(PAGE_TITLES)
    .filter((k) => k !== "/")
    .find((k) => pathname.startsWith(k));
  return match ? PAGE_TITLES[match] : "IT Finance";
}

export function Header() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { selectedCompany, setSelectedCompany } = useCompany();

  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm px-4 lg:px-6">
      {/* Left: mobile menu + page title */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <MobileSidebarTrigger />
        <h1 className="text-base font-semibold text-white truncate">
          {pageTitle}
        </h1>
      </div>

      {/* Right: company selector + theme toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Company selector */}
        <Select
          value={selectedCompany}
          onValueChange={(val) => {
            if (val !== null) setSelectedCompany(val as string);
          }}
        >
          <SelectTrigger className="w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPANIES.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-800 relative"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>
    </header>
  );
}
