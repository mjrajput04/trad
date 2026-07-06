import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Cell, Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { getTrades, getAccountSummary } from "@/lib/api/ibkr";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/journal")({
  head: () => ({ meta: [{ title: "Journal · NOVA" }, { name: "description", content: "Executed trades pulled live from IBKR." }] }),
  component: Journal,
});

function Journal() {
  const { data: trades = [], isLoading, isError, error } = useQuery({
    queryKey: ["ibkr-trades"],
    queryFn: () => getTrades(6),
    refetchInterval: 30_000,
  });

  const { data: summary } = useQuery({
    queryKey: ["ibkr-summary"],
    queryFn: getAccountSummary,
    refetchInterval: 30_000,
  });

  const buys = trades.filter((t) => t.side === "BUY").length;
  const sells = trades.length - buys;
  const totalCommission = trades.reduce((a, t) => a + Math.abs(t.commission), 0);
  const grossTraded = trades.reduce((a, t) => a + Math.abs(t.netAmount || t.price * t.quantity), 0);

  // Group executions per day for the daily activity chart
  const byDay = new Map<string, { label: string; traded: number; count: number }>();
  for (const t of trades) {
    if (!t.time) continue;
    const d = new Date(t.time);
    // Key on the LOCAL calendar day so the key and its label never disagree
    // (a UTC key with a local label splits/mislabels bars near midnight).
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cur = byDay.get(key) ?? {
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      traded: 0,
      count: 0,
    };
    cur.traded += Math.abs(t.netAmount || t.price * t.quantity);
    cur.count += 1;
    byDay.set(key, cur);
  }
  const daily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Trade Journal</h1>
        <p className="text-sm text-muted-foreground">Executions pulled live from your IBKR account (last ~1 week).</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini label="Executions" value={String(trades.length)} color="text-info" />
        <Mini label="Buys / Sells" value={`${buys} / ${sells}`} color="text-violet" />
        <Mini label="Gross Traded" value={`$${fmtMoney(grossTraded, 0)}`} color="text-bull" />
        <Mini
          label="Realized P&L (acct)"
          value={`${(summary?.realizedPnl ?? 0) >= 0 ? "+" : ""}$${fmtMoney(summary?.realizedPnl ?? 0)}`}
          color={(summary?.realizedPnl ?? 0) >= 0 ? "text-bull" : "text-bear"}
        />
      </div>

      {daily.length > 0 && (
        <div className="rounded-2xl glass p-5">
          <div className="text-sm font-semibold mb-3">Daily Traded Value</div>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <BarChart data={daily}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "oklch(0.66 0.018 255)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "oklch(0.66 0.018 255)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.20 0.015 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: string) => (name === "traded" ? [`$${fmtMoney(Number(v))}`, "Traded"] : [v, name])}
                />
                <Bar dataKey="traded" radius={[4, 4, 0, 0]}>
                  {daily.map((d, i) => (
                    <Cell key={i} fill="oklch(0.74 0.18 235)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">Could not load trades from IBKR</div>
          <div className="text-muted-foreground text-xs">{(error as Error)?.message}</div>
        </div>
      ) : trades.length === 0 ? (
        <div className="rounded-2xl glass p-10 text-center text-muted-foreground text-sm">
          No executions in the last week. Trades placed from this app will appear here.
        </div>
      ) : (
        <div className="rounded-2xl glass overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground hairline-b">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Symbol</div>
            <div className="col-span-2">Side</div>
            <div className="col-span-2 text-right">Qty</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">Value</div>
          </div>
          {trades.map((t) => (
            <div key={t.executionId} className="grid grid-cols-12 items-center px-4 py-3 hairline-b last:border-0 hover:bg-surface-2 transition">
              <div className="col-span-2 text-xs text-muted-foreground num">
                {t.time ? new Date(t.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </div>
              <div className="col-span-2 text-sm font-semibold">{t.symbol}</div>
              <div className="col-span-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.side === "BUY" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
                  {t.side}
                </span>
              </div>
              <div className="col-span-2 text-right num text-sm">{t.quantity}</div>
              <div className="col-span-2 text-right num text-sm">${fmtMoney(t.price)}</div>
              <div className="col-span-2 text-right num text-sm text-muted-foreground">
                ${fmtMoney(Math.abs(t.netAmount || t.price * t.quantity))}
              </div>
            </div>
          ))}
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
