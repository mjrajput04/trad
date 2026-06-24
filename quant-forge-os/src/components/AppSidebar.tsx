import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Eye,
  Radar,
  Wallet,
  Layers,
  ListOrdered,
  Newspaper,
  BellRing,
  BookOpen,
  Sparkles,
  Plug,
  Settings,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/portfolio", label: "Portfolio", icon: Wallet },
  { to: "/positions", label: "Positions", icon: Layers },
  { to: "/orders", label: "Orders", icon: ListOrdered },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/journal", label: "Journal", icon: BookOpen },
] as const;

const AI = [
  { to: "/copilot", label: "AI Copilot", icon: Sparkles },
] as const;

const SYS = [
  { to: "/broker", label: "Broker / IBKR", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function Item({ to, label, icon: Icon }: { to: string; label: string; icon: any }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
        active
          ? "bg-[oklch(0.74_0.18_235/0.12)] text-foreground"
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

export function AppSidebar() {
  return (
    <aside className="hidden md:flex flex-col w-[240px] shrink-0 bg-sidebar hairline-r sticky top-0 h-screen">
      <div className="flex items-center gap-2.5 px-5 h-14 hairline-b shrink-0">
        <div className="relative">
          <div className="h-7 w-7 rounded-lg gradient-primary grid place-items-center glow-primary">
            <TrendingUp className="h-4 w-4 text-background" strokeWidth={2.5} />
          </div>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">NOVA</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-[0.18em]">Terminal</div>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-6">
        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Trading</div>
          {NAV.map((n) => <Item key={n.to} {...n} />)}
        </div>
        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Intelligence</div>
          {AI.map((n) => <Item key={n.to} {...n} />)}
        </div>
        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">System</div>
          {SYS.map((n) => <Item key={n.to} {...n} />)}
        </div>
      </nav>
    </aside>
  );
}
