import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Loader2, Trophy, TrendingDown } from "lucide-react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAccountSummary, getPositions, type Trade } from "@/lib/api/ibkr";
import { getTradesAllTime } from "@/lib/trade-store";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/analysis")({
  head: () => ({ meta: [{ title: "Analysis · NOVA" }, { name: "description", content: "Where your profit and loss actually came from." }] }),
  component: Analysis,
});

const BULL = "var(--bull)";
const BEAR = "var(--bear)";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${fmtMoney(Math.abs(n))}`;
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayLabel = (t: number) => new Date(t).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });

interface SymbolPnl {
  symbol: string;
  realized: number;
  qtyClosed: number;
  trips: number;
  wins: number;
  losses: number;
}

/**
 * FIFO round-trip matcher over the raw executions. Only quantity that was BOTH
 * opened and closed inside the window counts — no guessed cost basis. Each
 * closing fill becomes one "trip" with its realized P&L, attributed to the day
 * it closed.
 */
function computeRealized(trades: Trade[]) {
  const bySym = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.symbol || !t.quantity || !t.price) continue;
    if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
    bySym.get(t.symbol)!.push(t);
  }

  const symbols: SymbolPnl[] = [];
  const byDay = new Map<string, { t: number; pnl: number }>();
  let wins = 0;
  let losses = 0;

  for (const [symbol, fills] of bySym) {
    fills.sort((a, b) => a.time - b.time);
    // Signed lots: +qty = long inventory, -qty = short inventory.
    const lots: { qty: number; price: number }[] = [];
    const s: SymbolPnl = { symbol, realized: 0, qtyClosed: 0, trips: 0, wins: 0, losses: 0 };

    for (const f of fills) {
      const dir = f.side === "BUY" ? 1 : -1;
      let remaining = f.quantity;
      let fillPnl = 0;
      let matchedAny = false;

      while (remaining > 0 && lots.length > 0 && Math.sign(lots[0].qty) === -dir) {
        const lot = lots[0];
        const matched = Math.min(remaining, Math.abs(lot.qty));
        // Long lot closed by a sell: (sell - buy) · qty. Short lot covered by a
        // buy: (sell - buy) · qty with the lot as the sell. Same formula, swapped.
        const pnl = lot.qty > 0 ? (f.price - lot.price) * matched : (lot.price - f.price) * matched;
        fillPnl += pnl;
        s.realized += pnl;
        s.qtyClosed += matched;
        matchedAny = true;
        lot.qty -= matched * Math.sign(lot.qty);
        if (lot.qty === 0) lots.shift();
        remaining -= matched;
      }
      if (remaining > 0) lots.push({ qty: dir * remaining, price: f.price });

      if (matchedAny) {
        s.trips += 1;
        if (fillPnl >= 0) { s.wins += 1; wins += 1; } else { s.losses += 1; losses += 1; }
        const k = dayKey(f.time);
        const cur = byDay.get(k) ?? { t: f.time, pnl: 0 };
        cur.pnl += fillPnl;
        byDay.set(k, cur);
      }
    }
    if (s.trips > 0) symbols.push(s);
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ label: dayLabel(v.t), pnl: Number(v.pnl.toFixed(2)) }));
  symbols.sort((a, b) => b.realized - a.realized);
  return { symbols, daily, wins, losses };
}

function Analysis() {
  const { data: trades = [], isLoading, isError, error } = useQuery({
    // Full archived history (our DB) + IBKR's live week — not just 7 days.
    queryKey: ["trades-all-time"],
    queryFn: getTradesAllTime,
    refetchInterval: 60_000,
  });
  const { data: positions = [] } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 15_000,
    retry: false,
  });
  const { data: summary } = useQuery({
    queryKey: ["ibkr-summary"],
    queryFn: getAccountSummary,
    refetchInterval: 30_000,
  });

  const { symbols, daily, wins, losses } = computeRealized(trades);
  const realized7d = symbols.reduce((a, s) => a + s.realized, 0);
  const commissions = trades.reduce((a, t) => a + Math.abs(t.commission || 0), 0);
  const unrealized = positions.reduce((a, p) => a + (p.pnl || 0), 0);
  const trips = wins + losses;
  const winRate = trips > 0 ? (wins / trips) * 100 : null;
  const best = symbols[0];
  const worst = symbols.length > 1 ? symbols[symbols.length - 1] : null;

  const maxAbsSym = Math.max(1, ...symbols.map((s) => Math.abs(s.realized)));
  const maxAbsPos = Math.max(1, ...positions.map((p) => Math.abs(p.pnl || 0)));

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-info" /> P&L Analysis
        </h1>
        <p className="text-sm text-muted-foreground">
          Where your profit and loss actually came from — closed round-trips from your FULL archived history plus your open positions.
        </p>
      </div>

      {/* ---- Stat tiles ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Realized P&L (7d)" value={signed(realized7d)} tone={realized7d >= 0 ? "bull" : "bear"} sub={`${trips} closed trip${trips === 1 ? "" : "s"}`} />
        <Tile label="Unrealized P&L (open)" value={signed(unrealized)} tone={unrealized >= 0 ? "bull" : "bear"} sub={`${positions.length} open position${positions.length === 1 ? "" : "s"}`} />
        <Tile label="Win rate (7d)" value={winRate != null ? `${winRate.toFixed(0)}%` : "—"} tone={winRate != null && winRate >= 50 ? "bull" : "muted"} sub={trips > 0 ? `${wins}W · ${losses}L` : "no closed trades yet"} />
        <Tile label="Commissions (7d)" value={`$${fmtMoney(commissions)}`} tone="muted" sub="deducted by IBKR" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">Could not load executions from IBKR</div>
          <div className="text-muted-foreground text-xs">{(error as Error)?.message}</div>
        </div>
      ) : (
        <>
          {/* ---- Biggest winner / loser ---- */}
          {(best || worst) && (
            <div className="grid sm:grid-cols-2 gap-3">
              {best && best.realized > 0 && (
                <div className="rounded-2xl glass p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-bull/15 grid place-items-center"><Trophy className="h-4 w-4 text-bull" /></div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best trade (7d)</div>
                    <div className="text-sm font-semibold">{best.symbol} <span className="num text-bull">{signed(best.realized)}</span></div>
                  </div>
                </div>
              )}
              {worst && worst.realized < 0 && (
                <div className="rounded-2xl glass p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-bear/15 grid place-items-center"><TrendingDown className="h-4 w-4 text-bear" /></div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Worst trade (7d)</div>
                    <div className="text-sm font-semibold">{worst.symbol} <span className="num text-bear">{signed(worst.realized)}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Daily realized P&L ---- */}
          {daily.length > 0 && (
            <div className="rounded-2xl glass p-5">
              <div className="text-sm font-semibold mb-1">Daily Realized P&L</div>
              <p className="text-[11px] text-muted-foreground mb-3">Green above the line = profitable day, red below = losing day.</p>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      cursor={{ fill: "var(--grid)" }}
                      contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: any) => [signed(Number(v)), "Realized P&L"]}
                    />
                    <ReferenceLine y={0} stroke="var(--line-strong)" />
                    <Bar dataKey="pnl" radius={3} maxBarSize={48}>
                      {daily.map((d, i) => (
                        <Cell key={i} fill={d.pnl >= 0 ? BULL : BEAR} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ---- Realized P&L per symbol ---- */}
          <div className="rounded-2xl glass p-5">
            <div className="text-sm font-semibold mb-1">Realized P&L by Stock (7d)</div>
            <p className="text-[11px] text-muted-foreground mb-3">Only round-trips (buy AND sell inside the window) are counted — no guessed numbers.</p>
            {symbols.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">No closed round-trips yet.</div>
            ) : (
              <div className="space-y-1.5">
                {symbols.map((s) => {
                  const upSym = s.realized >= 0;
                  const w = Math.max(3, (Math.abs(s.realized) / maxAbsSym) * 100);
                  return (
                    <div key={s.symbol} className="flex items-center gap-3 rounded-lg hairline bg-surface-1 px-3 py-2">
                      <Link to="/stock/$symbol" params={{ symbol: s.symbol }} className="w-16 shrink-0 text-sm font-semibold hover:text-primary transition">{s.symbol}</Link>
                      <div className="flex-1 min-w-0">
                        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${w}%`, background: upSym ? BULL : BEAR, opacity: 0.85 }} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{s.trips} trip{s.trips === 1 ? "" : "s"} · {s.qtyClosed} sh · {s.wins}W/{s.losses}L</div>
                      </div>
                      <div className={`w-24 shrink-0 text-right num text-sm font-semibold ${upSym ? "text-bull" : "text-bear"}`}>{signed(s.realized)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---- Open positions (unrealized) ---- */}
          <div className="rounded-2xl glass p-5">
            <div className="text-sm font-semibold mb-1">Open Positions — Unrealized P&L</div>
            <p className="text-[11px] text-muted-foreground mb-3">Live mark-to-market from IBKR — this is what you'd realize if you closed now.</p>
            {positions.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">No open positions.</div>
            ) : (
              <div className="space-y-1.5">
                {[...positions].sort((a, b) => (b.pnl || 0) - (a.pnl || 0)).map((p) => {
                  const upPos = (p.pnl || 0) >= 0;
                  const w = Math.max(3, (Math.abs(p.pnl || 0) / maxAbsPos) * 100);
                  return (
                    <div key={p.conid} className="flex items-center gap-3 rounded-lg hairline bg-surface-1 px-3 py-2">
                      <Link to="/stock/$symbol" params={{ symbol: p.symbol }} className="w-16 shrink-0 text-sm font-semibold hover:text-primary transition">{p.symbol}</Link>
                      <div className="flex-1 min-w-0">
                        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${w}%`, background: upPos ? BULL : BEAR, opacity: 0.85 }} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {p.quantity} sh · ${fmtMoney(p.entryPrice)} → ${fmtMoney(p.currentPrice)} · {p.side}
                        </div>
                      </div>
                      <div className={`w-24 shrink-0 text-right num text-sm font-semibold ${upPos ? "text-bull" : "text-bear"}`}>{signed(p.pnl || 0)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---- IBKR's own account number, for reference ---- */}
          <p className="text-[11px] text-muted-foreground">
            IBKR account realized P&L (today, their number): <span className={`num ${(summary?.realizedPnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{signed(summary?.realizedPnl ?? 0)}</span>.
            Positions opened before the 7-day window can't be matched to a cost basis here and are excluded from the round-trip numbers.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "bull" | "bear" | "muted" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground";
  return (
    <div className="rounded-xl glass p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-2 text-xl font-semibold num ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
