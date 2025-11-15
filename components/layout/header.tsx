"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon, LogOut } from "lucide-react";
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
import { useSession, signOut } from "next-auth/react";

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
  const { data: session } = useSession();

  const pageTitle = getPageTitle(pathname);

  // Derive user initials for the avatar fallback
  const userName = session?.user?.name ?? "";
  const userInitials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");

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

        {/* User info + sign out (only visible when authenticated) */}
        {session?.user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            {/* Avatar: photo if available, else initials circle */}
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={userName}
                className="h-7 w-7 rounded-full object-cover ring-1 ring-slate-700"
              />
            ) : (
              <div
                className="h-7 w-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-semibold ring-1 ring-slate-700 select-none"
                aria-label={userName}
              >
                {userInitials || "?"}
              </div>
            )}

            {/* Name — hidden on small screens */}
            <span className="hidden sm:block text-sm text-slate-300 max-w-[140px] truncate">
              {session.user.name}
            </span>

            {/* Sign out */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-800"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
