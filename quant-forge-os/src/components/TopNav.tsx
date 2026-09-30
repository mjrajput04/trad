import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BellRing, Sparkles, Layers, ListOrdered, Wallet, Eye, Coins,
  BarChart3, History, Radar, Plug, Settings as SettingsIcon,
  TrendingUp, ChevronDown, Loader2, LogOut, Sun, Moon, Lock, Search, X,
} from "lucide-react";
import { SymbolSearch } from "./SymbolSearch";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { useTradingAllowed } from "@/lib/app-flags";
import { getAuthStatus, ensureSession, tickle, GATEWAY_LOGIN_URL } from "@/lib/api/ibkr";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Single-row navigation used by every account except the control one, which
// keeps the original sidebar terminal. Logo, every section and the account
// controls share one bar, so the page below gets the full width.

const NAV = [
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/fno-alerts", label: "F&O", icon: Sparkles },
  { to: "/positions", label: "Positions", icon: Layers },
  { to: "/orders", label: "Orders", icon: ListOrdered },
  { to: "/portfolio", label: "Portfolio", icon: Wallet },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/options", label: "Options", icon: Coins },
  { to: "/analysis", label: "Analysis", icon: BarChart3 },
  { to: "/history", label: "History", icon: History },
  { to: "/scanner", label: "Scanner", icon: Radar },
] as const;

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: any }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to || (to === "/alerts" && pathname === "/");
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[13px] whitespace-nowrap transition-colors",
        active
          ? "bg-surface-2 text-foreground font-semibold"
          : "text-muted-foreground font-medium hover:bg-surface-2/60 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
      {label}
    </Link>
  );
}

export function TopNav() {
  const [now, setNow] = useState<Date | null>(null);
  const [reviving, setReviving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { user, signOut } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const { allowed } = useTradingAllowed(user?.email);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: authStatus } = useQuery({
    queryKey: ["ibkr-auth"],
    queryFn: getAuthStatus,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const reviveOrLogin = async () => {
    if (reviving) return;
    setReviving(true);
    try {
      await tickle().catch(() => {});
      await ensureSession(true);
      const st = await getAuthStatus();
      if (st.authenticated) {
        toast.success("IBKR session reconnected");
        qc.invalidateQueries();
        return;
      }
      toast.info("Session expired — opening the IBKR login page");
      window.open(GATEWAY_LOGIN_URL, "_blank", "noopener");
    } finally {
      setReviving(false);
    }
  };

  const et = now ? new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })) : null;
  const weekday = et ? et.getDay() >= 1 && et.getDay() <= 5 : false;
  const mins = et ? et.getHours() * 60 + et.getMinutes() : 0;
  const open = weekday && mins >= 9 * 60 + 30 && mins < 16 * 60;

  const ibkrOk = !!authStatus?.authenticated;
  const email = user?.email ?? "";
  const initials = (email.split("@")[0] || "U").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 bg-[var(--topbar-bg)] backdrop-blur-xl hairline-b">
      <div className="h-14 flex items-center gap-1.5 px-3 md:px-4">
        {/* brand */}
        <Link to="/alerts" className="flex items-center gap-2 shrink-0 mr-1">
          <div className="h-7 w-7 rounded-lg gradient-primary grid place-items-center glow-primary">
            <TrendingUp className="h-4 w-4 text-background" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold tracking-tight hidden sm:inline">NOVA</span>
        </Link>

        {/* sections — the whole middle of the bar, scrolls when space is tight */}
        <nav className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {NAV.map((n) => <NavItem key={n.to} {...n} />)}
        </nav>

        {/* account controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!allowed && (
            <span
              title="Trading is switched off for this account"
              className="hidden lg:inline-flex items-center gap-1 rounded-md bg-surface-2 hairline px-2 py-1 text-[11px] font-medium text-muted-foreground"
            >
              <Lock className="h-3 w-3" /> View only
            </span>
          )}

          <button
            onClick={() => setSearchOpen((v) => !v)}
            title="Search symbols"
            className="h-9 w-9 grid place-items-center rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-muted-foreground hover:text-foreground transition"
          >
            {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>

          <button
            onClick={() => (ibkrOk ? navigate({ to: "/broker" }) : reviveOrLogin())}
            disabled={reviving}
            title={ibkrOk ? "IBKR session active" : "Session expired — tap to reconnect"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 h-9 text-[11px] font-semibold transition disabled:opacity-60 ${
              ibkrOk ? "bg-bull/10 text-bull hover:bg-bull/20" : "bg-bear/10 text-bear hover:bg-bear/20"
            }`}
          >
            {reviving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full ${ibkrOk ? "bg-bull" : "bg-bear"}`} />
            )}
            <span className="hidden md:inline">{ibkrOk ? (open ? "Live" : "Connected") : "Expired"}</span>
          </button>

          <button
            onClick={toggleTheme}
            title={theme === "light" ? "Dark mode" : "Light mode"}
            className="h-9 w-9 grid place-items-center rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-muted-foreground hover:text-foreground transition"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1.5 h-9 rounded-lg hairline bg-surface-1 hover:bg-surface-2 px-2 md:px-2.5 text-[12px] text-foreground transition">
                <span className="md:hidden h-6 w-6 rounded-full gradient-primary grid place-items-center text-[10px] font-bold text-background">
                  {initials}
                </span>
                <span className="hidden md:inline max-w-[170px] truncate">{email}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground font-normal">Signed in as</span>
                <span className="truncate text-sm">{email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: "/broker" })}>
                <Plug className="h-4 w-4 mr-2" /> Broker / IBKR
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                <SettingsIcon className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut()} className="text-bear focus:text-bear">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* search drops under the bar so the nav row stays one clean line */}
      {searchOpen && (
        <div className="hairline-t px-3 md:px-4 py-2 flex items-center">
          <SymbolSearch />
        </div>
      )}
    </header>
  );
}
