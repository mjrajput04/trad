import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fmtMoney } from "@/lib/market-data";
import { getQuotes } from "@/lib/api/ibkr";
import { UNIVERSE_SYMBOLS } from "@/lib/symbols";
import { Delta } from "@/components/Delta";
import { Radar, Zap, TrendingUp, TrendingDown, Activity, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_app/scanner")({
  head: () => ({ meta: [{ title: "Scanner · NOVA" }, { name: "description", content: "Realtime scans over live IBKR quotes — movers, volume, gaps." }] }),
  component: ScannerPage,
});

// Each scan is computed from LIVE IBKR snapshot data (no fabricated signals).
const SCANNERS = [
  { id: "gainers", name: "Top Gainers", icon: TrendingUp, color: "text-bull", desc: "Largest % gain today" },
  { id: "losers", name: "Top Losers", icon: TrendingDown, color: "text-bear", desc: "Largest % loss today" },
  { id: "volume", name: "Volume Leaders", icon: Activity, color: "text-violet", desc: "Highest share volume today" },
  { id: "gap", name: "Gappers", icon: Zap, color: "text-warn", desc: "Largest open vs prior close gap" },
  { id: "range", name: "Range Breakers", icon: Radar, color: "text-info", desc: "Trading near today's high/low" },
] as const;

type ScannerDef = (typeof SCANNERS)[number];

function ScannerPage() {
  const navigate = useNavigate();
  const [activeScanner, setActiveScanner] = useState<ScannerDef>(SCANNERS[0]);

  const { data: quotes = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["scanner-quotes"],
    queryFn: () => getQuotes(UNIVERSE_SYMBOLS),
    refetchInterval: 3000,
    staleTime: 1500,
  });

  const scans = useMemo(() => {
    const live = quotes.filter((q) => q.last > 0);

    const enriched = live.map((q) => {
      const gapPct = q.open > 0 && q.prevClose > 0 ? ((q.open - q.prevClose) / q.prevClose) * 100 : 0;
      // Position of last price within today's range: 100 = at high, 0 = at low.
      const rangePos = q.high > q.low ? ((q.last - q.low) / (q.high - q.low)) * 100 : 50;
      return { ...q, gapPct, rangePos };
    });

    const byId: Record<string, typeof enriched> = {
      gainers: [...enriched].filter((q) => q.changePct > 0).sort((a, b) => b.changePct - a.changePct),
      losers: [...enriched].filter((q) => q.changePct < 0).sort((a, b) => a.changePct - b.changePct),
      volume: [...enriched].filter((q) => q.volume > 0).sort((a, b) => b.volume - a.volume),
      gap: [...enriched].filter((q) => Math.abs(q.gapPct) >= 0.5).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)),
      range: [...enriched].filter((q) => q.rangePos >= 95 || q.rangePos <= 5).sort((a, b) => Math.abs(b.rangePos - 50) - Math.abs(a.rangePos - 50)),
    };
    return byId;
  }, [quotes]);

  const hits = (scans[activeScanner.id] ?? []).slice(0, 15).map((q) => {
    let trigger = "";
    if (activeScanner.id === "gap") {
      trigger = `Gap ${q.gapPct >= 0 ? "+" : ""}${q.gapPct.toFixed(1)}% · ${q.changePct > q.gapPct ? "Extending" : "Fading"}`;
    } else if (activeScanner.id === "volume") {
      trigger = `${(q.volume / 1_000_000).toFixed(1)}M shares traded`;
    } else if (activeScanner.id === "range") {
      trigger = q.rangePos >= 95 ? "At day high" : "At day low";
    } else {
      trigger = `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}% today`;
    }
    return { ...q, trigger };
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Market Scanner</h1>
          <p className="text-sm text-muted-foreground">Live scans over IBKR quotes for the {UNIVERSE_SYMBOLS.length}-symbol universe.</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 hairline px-2.5 py-1">
            <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? "bg-warn animate-pulse" : "bg-bull pulse-dot"}`} />
            {isLoading ? "Syncing..." : "Live from IBKR"}
          </span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SCANNERS.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveScanner(s)}
            className={`rounded-xl glass p-4 cursor-pointer transition group border-2 ${activeScanner.id === s.id ? "border-primary bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-surface-2 grid place-items-center hairline">
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="text-sm font-semibold">{s.name}</div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {isLoading ? "..." : `${(scans[s.id] ?? []).length} hits`}
              </div>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">{s.desc}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl glass p-5 min-h-[400px]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold flex items-center gap-2 uppercase tracking-tight">
            <Radar className="h-4 w-4 text-info" /> Live Hits — {activeScanner.name}
          </div>
          <span className="text-[11px] text-muted-foreground flex items-center gap-2">
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {isLoading ? "Fetching real-time data..." : lastUpdated ? `Updated ${lastUpdated}` : ""}
          </span>
        </div>

        <div className="grid grid-cols-12 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground hairline-b">
          <div className="col-span-2">Symbol</div>
          <div className="col-span-4">Trigger</div>
          <div className="col-span-2 text-right">Price</div>
          <div className="col-span-2 text-right">Change</div>
          <div className="col-span-2 text-right">Volume</div>
        </div>

        {!isLoading && hits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-xs">No hits for this scan right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {hits.map((q) => (
              <div
                key={q.conid}
                onClick={() => navigate({ to: `/stock/${q.symbol}` })}
                className="grid grid-cols-12 items-center px-3 py-3 hover:bg-surface-2 transition cursor-pointer"
              >
                <div className="col-span-2 text-sm font-semibold">{q.symbol}</div>
                <div className="col-span-4 text-xs text-muted-foreground">
                  {q.trigger}
                </div>
                <div className="col-span-2 text-right num text-sm font-medium">{fmtMoney(q.last)}</div>
                <div className="col-span-2 text-right">
                  <Delta value={q.changePct} />
                </div>
                <div className="col-span-2 text-right num text-xs text-muted-foreground">
                  {(q.volume / 1_000_000).toFixed(2)}M
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
