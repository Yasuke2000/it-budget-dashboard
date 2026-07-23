"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatPanel } from "@/components/ai/chat-panel";
import { MobileSidebarTrigger } from "@/components/layout/sidebar";
import { useCompany } from "@/components/layout/company-context";
import { DateRangePicker } from "@/components/layout/date-range-picker";
import { useSession, signOut } from "next-auth/react";
import { getRouteMeta } from "@/lib/routes";

interface CompanyOption {
  value: string;
  label: string;
}

const ALL_COMPANIES: CompanyOption = { value: "all", label: "All Companies" };

export function Header() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { selectedCompany, setSelectedCompany } = useCompany();
  const { data: session } = useSession();
  const [companies, setCompanies] = useState<CompanyOption[]>([ALL_COMPANIES]);

  // Populate the company selector from real company IDs so per-company
  // filtering actually matches the data layer (which filters by company.id).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data: { id: string; name: string }[]) => {
        if (cancelled || !Array.isArray(data)) return;
        setCompanies([ALL_COMPANIES, ...data.map((c) => ({ value: c.id, label: c.name }))]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const pageTitle = getRouteMeta(pathname).title;

  // Derive user initials for the avatar fallback
  const userName = session?.user?.name ?? "";
  const userInitials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");

  return (
    <>
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border bg-background/80 backdrop-blur-xl px-4 lg:px-6">
      {/* Left: mobile menu + page title */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <MobileSidebarTrigger />
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground truncate">
          {pageTitle}
        </h1>
      </div>

      {/* Right: date range picker + company selector + theme toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Date range picker */}
        <DateRangePicker />

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
            {companies.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* AI Chat toggle */}
        <Sheet>
          <SheetTrigger
            className="inline-flex items-center justify-center rounded-lg h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Open AI Assistant"
          >
            <Sparkles className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="right" className="w-[400px] sm:max-w-[400px] p-0 bg-popover border-border flex flex-col">
            <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
              <SheetTitle className="text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Assistant
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0">
              <ChatPanel />
            </div>
          </SheetContent>
        </Sheet>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent relative"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {/* User info + sign out (only visible when authenticated) */}
        {session?.user && (
          <div className="flex items-center gap-2 pl-2 border-l border-border">
            {/* Avatar: photo if available, else initials circle */}
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={userName}
                className="h-7 w-7 rounded-full object-cover ring-1 ring-border-strong"
              />
            ) : (
              <div
                className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xs font-semibold ring-1 ring-primary/30 select-none"
                aria-label={userName}
              >
                {userInitials || "?"}
              </div>
            )}

            {/* Name — hidden on small screens */}
            <span className="hidden sm:block text-sm text-muted-foreground max-w-[140px] truncate">
              {session.user.name}
            </span>

            {/* Sign out */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
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
    </>
  );
}
