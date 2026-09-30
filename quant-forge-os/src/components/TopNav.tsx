import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BellRing, Sparkles, Layers, ListOrdered, History, BarChart3,
  Eye, Coins, Radar, Wallet, Plug, Settings as SettingsIcon,
  TrendingUp, ChevronDown, Plug2, Loader2, LogOut, Sun, Moon, Lock,
} from "lucide-react";
import { LiveDot } from "./Delta";
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

// Horizontal navigation used by every account except the control one, which
// keeps the original sidebar layout. Two slim rows: identity + status on top,
// the sections underneath — no sidebar, so the content gets the full width.

const PRIMARY = [
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/fno-alerts", label: "F&O", icon: Sparkles },
  { to: "/positions", label: "Positions", icon: Layers },
  { to: "/orders", label: "Orders", icon: ListOrdered },
  { to: "/history", label: "History", icon: History },
  { to: "/analysis", label: "Analysis", icon: BarChart3 },
] as const;

const MORE = [
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/options", label: "F&O Options", icon: Coins },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/portfolio", label: "Portfolio", icon: Wallet },
  { to: "/broker", label: "Broker / IBKR", icon: Plug },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

function NavLink({ to, label, icon: Icon }: { to: string; label: string; icon: any }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={cn(
        "relative inline-flex items-center gap-1.5 px-3 h-full text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
      {label}
      {active && <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-primary" />}
    </Link>
  );
}

export function TopNav() {
  const [now, setNow] = useState<Date | null>(null);
  const [reviving, setReviving] = useState(false);
  const { user, signOut } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const { allowed } = useTradingAllowed(user?.email);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
  const session: "PRE" | "OPEN" | "AFTER" | "CLOSED" = !weekday
    ? "CLOSED"
    : mins >= 9 * 60 + 30 && mins < 16 * 60
      ? "OPEN"
      : mins >= 4 * 60 && mins < 9 * 60 + 30
        ? "PRE"
        : mins >= 16 * 60 && mins < 20 * 60
          ? "AFTER"
          : "CLOSED";
  const sessionStyle = {
    OPEN: "bg-bull/10 text-bull", PRE: "bg-warn/10 text-warn",
    AFTER: "bg-violet/10 text-violet", CLOSED: "bg-bear/10 text-bear",
  }[session];
  const sessionLabel = { OPEN: "Market Open", PRE: "Pre-market", AFTER: "After-hours", CLOSED: "Closed" }[session];
  const time = et ? et.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";

  const ibkrOk = !!authStatus?.authenticated;
  const email = user?.email ?? "";
  const initials = (email.split("@")[0] || "U").slice(0, 2).toUpperCase();
  const moreActive = MORE.some((m) => m.to === pathname);

  return (
    <header className="sticky top-0 z-30 bg-[var(--topbar-bg)] backdrop-blur-xl hairline-b">
      {/* row 1 — identity, session, search, status */}
      <div className="h-14 flex items-center gap-3 px-3 md:px-5">
        <Link to="/alerts" className="flex items-center gap-2.5 shrink-0">
          <div className="h-7 w-7 rounded-lg gradient-primary grid place-items-center glow-primary">
            <TrendingUp className="h-4 w-4 text-background" strokeWidth={2.5} />
          </div>
          <div className="leading-tight hidden sm:block">
            <div className="text-sm font-semibold tracking-tight">NOVA</div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-[0.2em]">Terminal</div>
          </div>
        </Link>

        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${sessionStyle}`}>
          <LiveDot />
          <span className="hidden sm:inline">{sessionLabel}</span>
          <span className="num hidden lg:inline opacity-70">· {time} ET</span>
        </div>

        <SymbolSearch />

        <div className="flex items-center gap-2 shrink-0">
          {!allowed && (
            <div
              title="Trading is switched off for this account"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-surface-2 hairline px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              <Lock className="h-3 w-3" /> View only
            </div>
          )}
          <button
            onClick={() => (ibkrOk ? navigate({ to: "/broker" }) : reviveOrLogin())}
            disabled={reviving}
            title={ibkrOk ? "IBKR session active" : "Tap to reconnect"}
            className={`inline-flex items-center gap-2 rounded-lg hairline px-2.5 md:px-3 h-9 text-xs transition disabled:opacity-60 ${
              ibkrOk ? "bg-bull/10 text-bull hover:bg-bull/20" : "bg-bear/10 text-bear hover:bg-bear/20"
            }`}
          >
            {reviving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug2 className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">{ibkrOk ? "Connected" : reviving ? "Reconnecting…" : "Reconnect"}</span>
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
              <button className="h-9 w-9 rounded-full gradient-primary grid place-items-center text-[11px] font-bold text-background hover:opacity-90 transition">
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground font-normal">Signed in as</span>
                <span className="truncate text-sm">{email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                <SettingsIcon className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => signOut()} className="text-bear focus:text-bear">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* row 2 — sections */}
      <div className="h-11 flex items-stretch px-1 md:px-4 hairline-t overflow-x-auto scrollbar-thin">
        {PRIMARY.map((n) => <NavLink key={n.to} {...n} />)}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "relative inline-flex items-center gap-1.5 px-3 h-full text-[13px] font-medium whitespace-nowrap transition-colors",
                moreActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              More <ChevronDown className="h-3.5 w-3.5" />
              {moreActive && <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-primary" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {MORE.map((m) => (
              <DropdownMenuItem key={m.to} onSelect={() => navigate({ to: m.to })}>
                <m.icon className="h-4 w-4 mr-2" /> {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
