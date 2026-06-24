import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Delta } from "@/components/Delta";
import { Brain, ShieldAlert, TrendingUp, Wallet, Loader2 } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtMoney } from "@/lib/market-data";
import { getAccountSummary, getPositions } from "@/lib/api/ibkr";

export const Route = createFileRoute("/_app/portfolio")({
  head: () => ({ meta: [{ title: "Portfolio · NOVA" }] }),
  component: Portfolio,
});

const COLORS = ["oklch(0.74 0.18 235)", "oklch(0.70 0.18 295)", "oklch(0.78 0.18 152)", "oklch(0.82 0.16 78)", "oklch(0.66 0.22 22)", "oklch(0.45 0.02 260)"];

function Portfolio() {
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["ibkr-summary"],
    queryFn: getAccountSummary,
    refetchInterval: 10_000,
  });

  const { data: positions = [], isLoading: loadingPos } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 10_000,
  });

  const isLoading = loadingSummary || loadingPos;

  // Build sector allocation from real positions
  const sectorMap: Record<string, number> = {};
  positions.forEach((p) => {
    const s = p.sector || p.assetClass || "Other";
    sectorMap[s] = (sectorMap[s] ?? 0) + Math.abs(p.marketValue ?? 0);
  });
  const totalMv = Object.values(sectorMap).reduce((a, b) => a + b, 0) || 1;
  const allocation = Object.entries(sectorMap).map(([name, value], i) => ({
    name,
    value: +((value / totalMv) * 100).toFixed(1),
    color: COLORS[i % COLORS.length],
  }));

  const totalPnl = positions.reduce((a, p) => a + (p.pnl ?? 0), 0);
  const unrealizedPct = summary?.netLiquidation ? (totalPnl / summary.netLiquidation) * 100 : 0;

  return (
    <div className="p-6 space-y-5">
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Net Liquidation" value={`$${fmtMoney(summary?.netLiquidation ?? 0)}`} delta={0} icon={Wallet} />
            <Kpi label="Unrealized P&L" value={`${totalPnl >= 0 ? "+" : ""}$${fmtMoney(totalPnl)}`} delta={unrealizedPct} icon={TrendingUp} />
            <Kpi label="Buying Power" value={`$${fmtMoney(summary?.buyingPower ?? 0)}`} delta={0} icon={TrendingUp} />
            <Kpi label="Excess Liquidity" value={`$${fmtMoney(summary?.excessLiquidity ?? 0)}`} delta={0} icon={ShieldAlert} suffix="" />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl glass p-5">
              <div className="text-sm font-semibold mb-3">Open Positions Summary</div>
              {positions.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-10">No open positions</div>
              ) : (
                <div className="space-y-2">
                  {positions.map((p) => {
                    const up = (p.pnl ?? 0) >= 0;
                    return (
                      <div key={p.conid} className="flex items-center justify-between rounded-xl hairline bg-surface-1 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-md bg-surface-2 grid place-items-center text-[10px] font-bold">{p.symbol?.slice(0, 2)}</div>
                          <div>
                            <div className="text-sm font-semibold">{p.symbol}</div>
                            <div className="text-[11px] text-muted-foreground">{p.quantity} shares @ ${fmtMoney(p.entryPrice)}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-semibold num ${up ? "text-bull" : "text-bear"}`}>{up ? "+" : ""}${fmtMoney(p.pnl ?? 0)}</div>
                          <Delta value={p.pnlPct} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl glass p-5">
              <div className="text-sm font-semibold mb-3">Allocation</div>
              {allocation.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-10">No positions</div>
              ) : (
                <>
                  <div className="h-[180px]">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={allocation} dataKey="value" innerRadius={45} outerRadius={70} stroke="none">
                          {allocation.map((a) => <Cell key={a.name} fill={a.color} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: "oklch(0.20 0.015 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 8, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {allocation.map((a) => (
                      <div key={a.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                          <span className="text-muted-foreground">{a.name}</span>
                        </div>
                        <span className="num">{a.value}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl glass p-5 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-violet/10 blur-3xl" />
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-md gradient-primary grid place-items-center"><Brain className="h-4 w-4 text-background" /></div>
              <div className="text-sm font-semibold">Account Overview</div>
            </div>
            <div className="grid md:grid-cols-3 gap-3 text-xs">
              {[
                { label: "Total Cash", value: `$${fmtMoney(summary?.totalCash ?? 0)}` },
                { label: "Init Margin Req", value: `$${fmtMoney(summary?.initMarginReq ?? 0)}` },
                { label: "Maint Margin Req", value: `$${fmtMoney(summary?.maintMarginReq ?? 0)}` },
              ].map((item) => (
                <div key={item.label} className="rounded-xl hairline bg-surface-1 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
                  <div className="mt-1.5 text-lg font-semibold num">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, delta, icon: Icon, suffix = "%" }: { label: string; value: string; delta: number; icon: any; suffix?: string }) {
  return (
    <div className="rounded-2xl glass p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold num">{value}</div>
        </div>
        <div className="h-9 w-9 rounded-lg bg-surface-2 grid place-items-center hairline"><Icon className="h-4 w-4 text-info" /></div>
      </div>
      <div className="mt-3"><Delta value={delta} suffix={suffix} /></div>
    </div>
  );
}
