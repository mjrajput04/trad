import { Plug2, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LiveDot } from "./Delta";
import { SymbolSearch } from "./SymbolSearch";
import { useAuth } from "@/lib/auth-context";
import { useTrading } from "@/lib/trading-context";
import { getAuthStatus, GATEWAY_LOGIN_URL } from "@/lib/api/ibkr";
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
  const { user, signOut } = useAuth();
  const { isPaper } = useTrading();
  const navigate = useNavigate();

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
    <header className="h-14 hairline-b flex items-center gap-4 px-5 bg-[oklch(0.17_0.013_260/0.6)] backdrop-blur-xl sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium ${
          isMarketOpen 
            ? 'bg-[oklch(0.78_0.18_152/0.12)] text-bull' 
            : 'bg-[oklch(0.66_0.22_22/0.12)] text-bear'
        }`}>
          <LiveDot />
          Market {isMarketOpen ? 'Open' : 'Closed'}
        </div>
        <div className="text-xs text-muted-foreground num">{date} · {time} ET</div>
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
            else window.open(GATEWAY_LOGIN_URL, "_blank", "noopener");
          }}
          title={ibkrOk ? "IBKR session active — open broker page" : "Click to log in to the IBKR gateway"}
          className={`hidden md:inline-flex items-center gap-2 rounded-lg hairline px-3 h-9 text-xs transition ${
          ibkrOk
            ? 'bg-[oklch(0.78_0.18_152/0.12)] text-bull hover:bg-[oklch(0.78_0.18_152/0.18)]'
            : 'bg-[oklch(0.66_0.22_22/0.12)] text-bear hover:bg-[oklch(0.66_0.22_22/0.18)]'
        }`}>
          <Plug2 className="h-3.5 w-3.5" />
          <span>{ibkrOk ? 'IBKR Connected' : 'IBKR Login'}</span>
          <LiveDot />
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
