import { Bell, Command, Search, Sparkles, Plug2, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LiveDot } from "./Delta";
import { SymbolSearch } from "./SymbolSearch";
import { useAuth } from "@/lib/auth-context";
import { useTrading } from "@/lib/trading-context";
import { getAuthStatus } from "@/lib/api/ibkr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar() {
  const [now, setNow] = useState(() => new Date());
  const { user, signOut } = useAuth();
  const { isPaper } = useTrading();
  
  const { data: authStatus } = useQuery({
    queryKey: ["ibkr-auth"],
    queryFn: getAuthStatus,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Market status
  const marketHours = now.getHours();
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const isMarketOpen = isWeekday && marketHours >= 9 && marketHours < 16;

  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

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
        <button className={`hidden md:inline-flex items-center gap-2 rounded-lg hairline px-3 h-9 text-xs transition ${
          authStatus?.connected 
            ? 'bg-[oklch(0.78_0.18_152/0.12)] text-bull hover:bg-[oklch(0.78_0.18_152/0.18)]'
            : 'bg-[oklch(0.66_0.22_22/0.12)] text-bear hover:bg-[oklch(0.66_0.22_22/0.18)]'
        }`}>
          <Plug2 className="h-3.5 w-3.5" />
          <span>IBKR {authStatus?.connected ? 'Connected' : 'Disconnected'}</span>
          <LiveDot />
        </button>
        <button className="inline-flex items-center gap-2 rounded-lg gradient-primary text-background px-3 h-9 text-xs font-semibold glow-primary">
          <Sparkles className="h-3.5 w-3.5" />
          AI Copilot
        </button>
        <button className="relative h-9 w-9 grid place-items-center rounded-lg hairline bg-surface-1 hover:bg-surface-2">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-bear glow-bear" />
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
