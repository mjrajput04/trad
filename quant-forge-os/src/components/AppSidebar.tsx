import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Eye,
  Radar,
  Wallet,
  Layers,
  ListOrdered,
  BellRing,
  Sparkles,
  History,
  BarChart3,
  Coins,
  Plug,
  Settings,
  TrendingUp,
  Menu,
  X,
  PanelLeftClose,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/alerts", label: "AI Stock Alerts", icon: BellRing },
  { to: "/fno-alerts", label: "AI F&O Alerts", icon: Sparkles },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/options", label: "F&O Options", icon: Coins },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/portfolio", label: "Portfolio", icon: Wallet },
  { to: "/positions", label: "Positions", icon: Layers },
  { to: "/orders", label: "Orders", icon: ListOrdered },
  { to: "/history", label: "History", icon: History },
  { to: "/analysis", label: "Analysis", icon: BarChart3 },
] as const;

const SYS = [
  { to: "/broker", label: "Broker / IBKR", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const COLLAPSE_KEY = "nova_sidebar_collapsed";
const PEEK_HIDE_MS = 600;   // hide this long after the pointer leaves
const PEEK_MAX_MS = 5000;   // safety: an idle peek closes itself after 5s

function BottomTab({ to, label, icon: Icon }: { to: string; label: string; icon: any }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center justify-center gap-1 transition",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className={cn("h-5 w-5", active && "drop-shadow")} />
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );
}

function Item({ to, label, icon: Icon, onNavigate }: { to: string; label: string; icon: any; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary glow-primary" />
      )}
      <Icon className={cn("h-4 w-4", active && "text-primary")} />
      <span className="font-medium">{label}</span>
    </Link>
  );
}

function SidebarBody({ onNavigate, onCollapse, collapseIcon }: {
  onNavigate?: () => void;
  onCollapse?: () => void;
  collapseIcon?: "close" | "x";
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 h-14 hairline-b shrink-0">
        <div className="relative">
          <div className="h-7 w-7 rounded-lg gradient-primary grid place-items-center glow-primary">
            <TrendingUp className="h-4 w-4 text-background" strokeWidth={2.5} />
          </div>
        </div>
        <div className="leading-tight flex-1 min-w-0">
          <div className="text-sm font-semibold tracking-tight">NOVA</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.18em]">Terminal</div>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title={collapseIcon === "x" ? "Close menu" : "Hide sidebar"}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition"
          >
            {collapseIcon === "x" ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-6">
        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Trading</div>
          {NAV.map((n) => <Item key={n.to} {...n} onNavigate={onNavigate} />)}
        </div>
        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">System</div>
          {SYS.map((n) => <Item key={n.to} {...n} onNavigate={onNavigate} />)}
        </div>
      </nav>
    </>
  );
}

export function AppSidebar() {
  // Desktop: collapsed hides the in-flow sidebar; hovering the left screen edge
  // "peeks" it as an overlay that hides again on mouse-leave (or after 5s).
  // Mobile has no hover, so a floating button opens the same panel as a drawer.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const [peek, setPeek] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { setMobileOpen(false); }, [pathname]); // navigating closes the drawer

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
  };
  const armMaxTimer = () => {
    if (maxTimer.current) clearTimeout(maxTimer.current);
    maxTimer.current = setTimeout(() => setPeek(false), PEEK_MAX_MS);
  };
  const openPeek = () => { clearTimers(); setPeek(true); armMaxTimer(); };
  const keepPeek = () => { if (hideTimer.current) clearTimeout(hideTimer.current); armMaxTimer(); };
  const scheduleHidePeek = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPeek(false), PEEK_HIDE_MS);
  };
  useEffect(() => () => clearTimers(), []);

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    setPeek(false);
    clearTimers();
    try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  };

  return (
    <>
      {/* ---- Desktop: in-flow sidebar (hidden when collapsed) ---- */}
      {!collapsed && (
        <aside className="hidden md:flex flex-col w-[240px] shrink-0 bg-sidebar hairline-r sticky top-0 h-screen">
          <SidebarBody onCollapse={() => setCollapsedPersist(true)} />
        </aside>
      )}

      {/* ---- Desktop collapsed: edge hover-zone + reopen tab ---- */}
      {collapsed && (
        <>
          <div
            className="hidden md:block fixed left-0 top-0 h-screen w-2 z-40"
            onMouseEnter={openPeek}
          />
          <button
            onClick={() => setCollapsedPersist(false)}
            onMouseEnter={openPeek}
            title="Open sidebar (click to pin)"
            className="hidden md:grid fixed left-0 top-20 z-40 h-10 w-6 place-items-center rounded-r-lg glass-strong text-muted-foreground hover:text-foreground transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* ---- Desktop peek overlay ---- */}
      {collapsed && peek && (
        <aside
          onMouseEnter={keepPeek}
          onMouseMove={keepPeek}
          onMouseLeave={scheduleHidePeek}
          className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-[240px] z-50 bg-sidebar hairline-r shadow-2xl animate-fade-up"
        >
          {/* the header button PINS it open while peeking */}
          <SidebarBody onCollapse={() => setCollapsedPersist(false)} onNavigate={() => setPeek(false)} />
          <div className="px-5 py-2 text-[10px] text-muted-foreground hairline-t">
            Hover away to hide · click ▣ to pin
          </div>
        </aside>
      )}

      {/* ---- Mobile: bottom navigation — the 4 most-used pages + Menu ---- */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 hairline-t bg-[var(--topbar-bg)] backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5 h-16">
          <BottomTab to="/alerts" label="Stocks" icon={BellRing} />
          <BottomTab to="/fno-alerts" label="F&O" icon={Sparkles} />
          <BottomTab to="/orders" label="Orders" icon={ListOrdered} />
          <BottomTab to="/broker" label="Broker" icon={Plug} />
          <button
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium">Menu</span>
          </button>
        </div>
      </nav>

      {/* ---- Mobile drawer ---- */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[260px] bg-sidebar hairline-r shadow-2xl flex flex-col animate-fade-up">
            <SidebarBody onCollapse={() => setMobileOpen(false)} collapseIcon="x" onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
