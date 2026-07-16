import { Plug2, LogOut, ShieldCheck, Loader2, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { LiveDot } from "./Delta";
import { SymbolSearch } from "./SymbolSearch";
import { useAuth } from "@/lib/auth-context";
import { useTrading } from "@/lib/trading-context";
import { useTheme } from "@/lib/theme";
import { getAuthStatus, ensureSession, tickle, GATEWAY_LOGIN_URL } from "@/lib/api/ibkr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar() {
  const [now, setNow] = useState<Date | null>(null);
  const [reviving, setReviving] = useState(false);
  const { user, signOut } = useAuth();
  const { isPaper } = useTrading();
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: authStatus } = useQuery({
    queryKey: ["ibkr-auth"],
    queryFn: getAuthStatus,
    refetchInterval: 30_000,
  });

  // Red badge click: first try to REVIVE the shared server-side gateway session
  // (ssodh/init + reauthenticate) — very often that's enough and nobody has to
  // do a full IBKR login. Only if that fails do we open the gateway login page.
  const reviveOrLogin = async () => {
    if (reviving) return;
    setReviving(true);
    try {
      await tickle().catch(() => {});
      await ensureSession(true);
      const st = await getAuthStatus();
      if (st.authenticated) {
        toast.success("IBKR session reconnected — no login needed");
        qc.invalidateQueries();
        return;
      }
      toast.info("Session expired — one person must log in to IBKR (opening login page)");
      window.open(GATEWAY_LOGIN_URL, "_blank", "noopener");
    } finally {
      setReviving(false);
    }
  };
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Market status in US/Eastern time (9:30–16:00, Mon–Fri)
  const et = now
    ? new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
    : null;
  const isWeekday = et ? et.getDay() >= 1 && et.getDay() <= 5 : false;
  const minutes = et ? et.getHours() * 60 + et.getMinutes() : 0;
  const isMarketOpen = isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;

  const time = et ? et.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "--:--:--";
  const date = et ? et.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

  const ibkrOk = !!authStatus?.authenticated;

  const email = user?.email ?? "";
  const initials = (email.split("@")[0] || "U").slice(0, 2).toUpperCase();

  return (
    <header className="h-14 hairline-b flex items-center gap-2 md:gap-4 px-3 md:px-5 bg-[var(--topbar-bg)] backdrop-blur-xl sticky top-0 z-30">
      <div className="flex items-center gap-2 shrink-0">
        <div className={`flex items-center gap-1.5 md:gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${
          isMarketOpen
            ? 'bg-bull/10 text-bull'
            : 'bg-bear/10 text-bear'
        }`}>
          <LiveDot />
          <span className="hidden sm:inline">Market </span>{isMarketOpen ? 'Open' : 'Closed'}
        </div>
        {/* full date+time only where there's room; wrapping this looked broken on phones */}
        <div className="hidden lg:block text-xs text-muted-foreground num whitespace-nowrap">{date} · {time} ET</div>
        <div className="hidden md:block lg:hidden text-xs text-muted-foreground num whitespace-nowrap">{time} ET</div>
      </div>

      {/* Search Bar */}
      <SymbolSearch />

      <div className="flex items-center gap-2">
        {isPaper && (
          <div className="flex items-center gap-1.5 rounded-full bg-warn/15 text-warn px-2.5 py-1 text-[11px] font-bold border border-warn/20 glow-warn animate-pulse">
            <ShieldCheck className="h-3 w-3" />
            PAPER
          </div>
        )}
        <button
          onClick={() => {
            if (ibkrOk) navigate({ to: "/broker" });
            else reviveOrLogin();
          }}
          disabled={reviving}
          title={ibkrOk ? "IBKR session active — open broker page" : "Click to reconnect (auto-tries revive first, login only if needed)"}
          className={`hidden md:inline-flex items-center gap-2 rounded-lg hairline px-3 h-9 text-xs transition disabled:opacity-60 ${
          ibkrOk
            ? 'bg-bull/10 text-bull hover:bg-bull/20'
            : 'bg-bear/10 text-bear hover:bg-bear/20'
        }`}>
          {reviving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug2 className="h-3.5 w-3.5" />}
          <span>{ibkrOk ? 'IBKR Connected' : reviving ? 'Reconnecting…' : 'IBKR Reconnect'}</span>
          <LiveDot />
        </button>

        {/* compact IBKR status for phones (the full button is md+ only) */}
        <button
          onClick={() => {
            if (ibkrOk) navigate({ to: "/broker" });
            else reviveOrLogin();
          }}
          disabled={reviving}
          title={ibkrOk ? "IBKR connected" : "Tap to reconnect IBKR"}
          className={`md:hidden h-9 w-9 grid place-items-center rounded-lg hairline transition disabled:opacity-60 ${
            ibkrOk ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear'
          }`}
        >
          {reviving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug2 className="h-4 w-4" />}
        </button>

        <button
          onClick={toggleTheme}
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
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
            <DropdownMenuItem onSelect={() => signOut()} className="text-bear focus:text-bear">
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
