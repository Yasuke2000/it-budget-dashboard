"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
  GitBranch,
  Landmark,
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
}
interface NavGroup {
  title: string | null;
  items: NavItem[];
}

// Grouped information architecture — turns a flat 15-item list into scannable
// sections. Order within a group runs most-used → least.
const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { label: "Overview", icon: LayoutDashboard, href: "/" },
      { label: "CFO Cockpit", icon: Landmark, href: "/cfo" },
    ],
  },
  {
    title: "Spend",
    items: [
      { label: "Invoices", icon: FileText, href: "/invoices" },
      { label: "Vendors", icon: Building2, href: "/vendors" },
      { label: "Contracts", icon: ScrollText, href: "/contracts" },
      { label: "Optimization", icon: Coins, href: "/savings" },
      { label: "Budget", icon: PiggyBank, href: "/budget" },
    ],
  },
  {
    title: "Assets & Team",
    items: [
      { label: "Licenses", icon: Key, href: "/licenses" },
      { label: "Devices", icon: Monitor, href: "/devices" },
      { label: "Personnel", icon: Users, href: "/personnel" },
      { label: "Developers", icon: GitBranch, href: "/developers" },
    ],
  },
  {
    title: "Data & Insights",
    items: [
      { label: "Insights", icon: Lightbulb, href: "/insights" },
      { label: "Import", icon: Upload, href: "/import" },
      { label: "Connectors", icon: Plug, href: "/connectors" },
    ],
  },
  {
    title: "System",
    items: [{ label: "Settings", icon: Settings, href: "/settings" }],
  },
];

// Peppol is hidden by default (no live Access Point); shown only when enabled in
// Settings. It slots into "Data & Insights" after Import.
const PEPPOL_ITEM: NavItem = { label: "Peppol", icon: FileCheck, href: "/peppol" };

function useNavGroups() {
  const [showPeppol, setShowPeppol] = useState(false);
  const [cfoAllowed, setCfoAllowed] = useState(true); // optimistic; hidden only if explicitly denied

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setShowPeppol(Boolean(d?.showPeppol)))
      .catch(() => {});
    fetch("/api/cfo-access")
      .then((r) => r.json())
      .then((d) => setCfoAllowed(d?.allowed !== false))
      .catch(() => {});
  }, []);

  return NAV_GROUPS.map((g) => {
    let items = g.items;
    if (!cfoAllowed) items = items.filter((i) => i.href !== "/cfo");
    if (showPeppol && g.title === "Data & Insights") {
      const at = items.findIndex((i) => i.href === "/import") + 1;
      items = [...items.slice(0, at), PEPPOL_ITEM, ...items.slice(at)];
    }
    return { ...g, items };
  }).filter((g) => g.items.length > 0);
}

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-4 h-16 border-b border-sidebar-border",
        collapsed && "justify-center px-0"
      )}
    >
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-gold/15 ring-1 ring-primary/30">
        <Landmark className="h-[18px] w-[18px] text-primary" />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            IT&nbsp;Finance
          </p>
          <p className="truncate text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            Cost Intelligence
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center py-3">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            IS_DEMO
              ? "bg-warning shadow-[0_0_8px_var(--warning)]"
              : "bg-positive shadow-[0_0_8px_var(--positive)]"
          )}
          title={IS_DEMO ? "Demo mode — sample data" : "Live — connected"}
        />
      </div>
    );
  }
  return (
    <div className="px-3 pt-3 pb-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2",
          IS_DEMO
            ? "border-warning/30 bg-warning/10"
            : "border-positive/30 bg-positive/10"
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            IS_DEMO
              ? "bg-warning shadow-[0_0_8px_var(--warning)]"
              : "bg-positive shadow-[0_0_8px_var(--positive)] animate-pulse"
          )}
        />
        <div className="leading-tight">
          <p
            className={cn(
              "text-[10.5px] font-bold uppercase tracking-[0.15em]",
              IS_DEMO ? "text-warning" : "text-positive"
            )}
          >
            {IS_DEMO ? "Demo Mode" : "Live"}
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {IS_DEMO ? "sample data only" : "connected to source"}
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = useNavGroups();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <BrandMark collapsed={collapsed} />
      <StatusBadge collapsed={collapsed} />

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group, gi) => (
          <div key={group.title ?? `g${gi}`} className={cn(gi > 0 && "mt-4")}>
            {group.title && !collapsed && (
              <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55">
                {group.title}
              </p>
            )}
            {group.title && collapsed && gi > 0 && (
              <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
            )}
            <div className="space-y-0.5">
              {group.items.map(({ label, icon: Icon, href }) => {
                const isActive =
                  href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    title={collapsed ? label : undefined}
                    className={cn(
                      "group relative flex items-center rounded-lg text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                      />
                    )}
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground/70 group-hover:text-foreground"
                      )}
                    />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: collapse toggle (desktop) + version */}
      <div className="border-t border-sidebar-border p-3">
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn(
              "flex w-full items-center rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              collapsed ? "justify-center px-0" : "gap-2 px-3"
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
        {!collapsed && (
          <p className="px-3 pt-2 text-[10.5px] text-muted-foreground/50">
            {IS_DEMO
              ? "Demo · no live API calls"
              : `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0"} · Live`}
          </p>
        )}
      </div>
    </div>
  );
}

// Persisted collapse state, read as an external store so we never call setState
// from an effect (which React Compiler disallows) and stay SSR-safe.
const COLLAPSE_KEY = "itdash_sidebar_collapsed";

function subscribeCollapse(cb: () => void) {
  window.addEventListener("itdash-sidebar", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("itdash-sidebar", cb);
    window.removeEventListener("storage", cb);
  };
}
function collapseSnapshot() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function collapseServerSnapshot() {
  return false;
}

export function Sidebar() {
  const collapsed = useSyncExternalStore(
    subscribeCollapse,
    collapseSnapshot,
    collapseServerSnapshot
  );

  // Reflect the width to the layout via a CSS var (external-system sync — allowed).
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      collapsed ? "4.25rem" : "16rem"
    );
  }, [collapsed]);

  const toggle = useCallback(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapseSnapshot() ? "0" : "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("itdash-sidebar"));
  }, []);

  return (
    <aside className="hidden lg:flex lg:flex-col lg:shrink-0 lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 border-r border-sidebar-border transition-[width] duration-300 ease-out lg:[width:var(--sidebar-w)]">
      <SidebarContent collapsed={collapsed} onToggle={toggle} />
    </aside>
  );
}

export function MobileSidebarTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="lg:hidden inline-flex items-center justify-center rounded-lg size-8 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
