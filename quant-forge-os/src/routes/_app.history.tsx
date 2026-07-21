import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, History as HistoryIcon } from "lucide-react";
import { getTradesAllTime } from "@/lib/trade-store";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/history")({
  head: () => ({ meta: [{ title: "History · NOVA" }, { name: "description", content: "Your executed IBKR trades." }] }),
  component: History,
});

// Trading days/times are US/Eastern — grouping by the viewer's IST clock
// split one US session across two days.
const dayKey = (t: number) =>
  new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
const dayLabel = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const timeLabel = (t: number) =>
  t ? `${new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET` : "—";

function History() {
  const { data: trades = [], isLoading, isError, error } = useQuery({
    // IBKR's week of executions gets archived into our own DB on every load,
    // so this returns ALL-TIME history, not just 7 days.
    queryKey: ["trades-all-time"],
    queryFn: getTradesAllTime,
    refetchInterval: 10_000, // provisional fills make fresh trades visible in seconds
  });

  const buys = trades.filter((t) => t.side === "BUY").length;
  const sells = trades.length - buys;
  const grossTraded = trades.reduce((a, t) => a + Math.abs(t.netAmount || t.price * t.quantity), 0);
  const totalCommission = trades.reduce((a, t) => a + Math.abs(t.commission), 0);

  // Group by day (most recent first)
  const groups = new Map<string, typeof trades>();
  for (const t of [...trades].sort((a, b) => b.time - a.time)) {
    const k = dayKey(t.time);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <HistoryIcon className="h-5 w-5 text-info" /> Trade History
        </h1>
        <p className="text-sm text-muted-foreground">
          All your executed IBKR trades — auto-archived to your own database every time the app loads
          (IBKR itself only keeps ~7 days).
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini label="Executions" value={String(trades.length)} color="text-info" />
        <Mini label="Buys / Sells" value={`${buys} / ${sells}`} color="text-violet" />
        <Mini label="Gross Traded" value={`$${fmtMoney(grossTraded, 0)}`} color="text-bull" />
        <Mini label="Commissions" value={`$${fmtMoney(totalCommission)}`} color="text-bear" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">Could not load trade history from IBKR</div>
          <div className="text-muted-foreground text-xs">{(error as Error)?.message}</div>
          <div className="text-muted-foreground text-xs mt-2">Make sure the IBKR gateway is logged in (Broker page).</div>
        </div>
      ) : trades.length === 0 ? (
        <div className="rounded-2xl glass p-10 text-center text-muted-foreground text-sm">
          No executed trades in the last 7 days. Trades placed from this app or IBKR will appear here.
        </div>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([k, dayTrades]) => {
            const dayGross = dayTrades.reduce((a, t) => a + Math.abs(t.netAmount || t.price * t.quantity), 0);
            return (
              <div key={k} className="rounded-2xl glass overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 hairline-b bg-surface-1/50">
                  <div className="text-sm font-semibold">{dayLabel(dayTrades[0].time)}</div>
                  <div className="text-[11px] text-muted-foreground num">{dayTrades.length} trades · ${fmtMoney(dayGross, 0)}</div>
                </div>
                {/* horizontal scroll on narrow screens so columns never collide */}
                <div className="overflow-x-auto scrollbar-thin">
                  <div className="min-w-[560px]">
                    <div className="grid grid-cols-12 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground hairline-b">
                      <div className="col-span-2">Time</div>
                      <div className="col-span-3">Symbol</div>
                      <div className="col-span-2">Side</div>
                      <div className="col-span-1 text-right">Qty</div>
                      <div className="col-span-2 text-right">Price</div>
                      <div className="col-span-2 text-right">Value</div>
                    </div>
                    {dayTrades.map((t) => (
                      <div key={t.executionId} className="grid grid-cols-12 items-center px-4 py-2.5 hairline-b last:border-0 hover:bg-surface-2 transition text-sm">
                        <div className="col-span-2 text-xs text-muted-foreground num whitespace-nowrap">{timeLabel(t.time)}</div>
                        <div className="col-span-3 font-semibold">{t.symbol}</div>
                        <div className="col-span-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${t.side === "BUY" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{t.side}</span>
                        </div>
                        <div className="col-span-1 text-right num">{t.quantity}</div>
                        <div className="col-span-2 text-right num whitespace-nowrap">${fmtMoney(t.price)}</div>
                        <div className="col-span-2 text-right num text-muted-foreground whitespace-nowrap">${fmtMoney(Math.abs(t.netAmount || t.price * t.quantity))}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl glass p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-2 text-xl font-semibold num ${color}`}>{value}</div>
    </div>
  );
}
