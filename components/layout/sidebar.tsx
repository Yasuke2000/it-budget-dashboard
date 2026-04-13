"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  FileText,
  Key,
  PiggyBank,
  Building2,
  Monitor,
  Settings,
  Upload,
  Menu,
  Users,
  FileCheck,
  Lightbulb,
  Plug,
  ScrollText,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

const IS_DEMO = true;

const navItems = [
  { label: "Overview", icon: LayoutDashboard, href: "/" },
  { label: "Invoices", icon: FileText, href: "/invoices" },
  { label: "Licenses", icon: Key, href: "/licenses" },
  { label: "Savings", icon: Coins, href: "/savings" },
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

function SidebarContent() {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-slate-950">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500/20">
          <BarChart3 className="h-5 w-5 text-teal-400" />
        </div>
        <span className="text-base font-bold text-white tracking-tight">
          IT Finance
        </span>
      </div>

      {/* Demo / Live badge */}
      <div className="px-4 pt-3 pb-1">
        {IS_DEMO ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-[11px] font-bold tracking-widest uppercase text-amber-400 leading-tight">
              DEMO MODE
            </p>
            <p className="text-[10px] text-amber-500/70 mt-0.5 leading-tight">
              sample data only
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
            <p className="text-[11px] font-bold tracking-widest uppercase text-emerald-400 leading-tight">
              LIVE
            </p>
            <p className="text-[10px] text-emerald-500/70 mt-0.5 leading-tight">
              connected
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {navItems.map(({ label, icon: Icon, href }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-slate-800 text-white border-l-2 border-teal-400 pl-[10px]"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50 border-l-2 border-transparent pl-[10px]"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive
                    ? "text-teal-400"
                    : "text-slate-500 group-hover:text-slate-300"
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 px-5 py-4">
        <p className="text-[11px] text-slate-600 font-medium">
          {IS_DEMO
            ? "Demo · No real API calls made"
            : `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0"} · Live`}
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 border-r border-slate-800">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebarTrigger() {
  return (
    <Sheet>
      <SheetTrigger
        className="lg:hidden inline-flex items-center justify-center rounded-lg size-8 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="p-0 w-64 bg-slate-950 border-slate-800"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarContent />
      </SheetContent>
    </Sheet>
  );
}
