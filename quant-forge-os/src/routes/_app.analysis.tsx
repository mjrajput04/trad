import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Loader2, Trophy, TrendingDown } from "lucide-react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAccountSummary, getPositions, type Trade } from "@/lib/api/broker";
import { getTradesAllTime } from "@/lib/trade-store";
import { computeRealized, dayKey } from "@/lib/pnl";
import { fmtMoney } from "@/lib/market-data";
import { brokerInfo } from "@/lib/broker";
import { activeBroker } from "@/lib/broker";

export const Route = createFileRoute("/_app/analysis")({
  head: () => ({ meta: [{ title: "Analysis · NOVA" }, { name: "description", content: "Where your profit and loss actually came from." }] }),
  component: Analysis,
});

const BULL = "var(--bull)";
const BEAR = "var(--bear)";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${fmtMoney(Math.abs(n))}`;
function Analysis() {
  const { data: trades = [], isLoading, isError, error } = useQuery({
    // Full archived history (our DB) + IBKR's live week — not just 7 days.
    queryKey: [activeBroker(), "trades-all-time"],
    queryFn: getTradesAllTime,
    refetchInterval: 15_000, // provisional fills make fresh trades visible in seconds
  });
  const { data: positions = [] } = useQuery({
    queryKey: [activeBroker(), "ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 15_000,
    retry: false,
  });
  const { data: summary } = useQuery({
    queryKey: [activeBroker(), "ibkr-summary"],
    queryFn: getAccountSummary,
    refetchInterval: 30_000,
  });

  const { symbols, daily, wins, losses, byDayKey, leftovers } = computeRealized(trades);
  const realizedTotal = symbols.reduce((a, s) => a + s.realized, 0);

  // Does the fill history actually account for the position we are holding?
  //
  // These figures come from walking the fills in order and carrying the running
  // position. If the history does not reach back far enough, the walk starts
  // mid-position — a cover with no short in front of it reads as opening a long
  // — and every number after it is wrong, confidently and silently. The honest
  // check is cheap: where the walk ends up must match what the broker says is
  // open. It did not on 24 Nov, when four fills past E*TRADE's 100-order page
  // invented $983 of loss and showed a +$803 day as -$180.
  const held = new Map(positions.map((p) => [p.symbol, p.quantity]));
  const mismatched = [...new Set([...leftovers.keys(), ...held.keys()])].filter(
    (sym) => Math.round((leftovers.get(sym) ?? 0) - (held.get(sym) ?? 0)) !== 0,
  );
  const commissions = trades.reduce((a, t) => a + Math.abs(t.commission || 0), 0);
  const unrealized = positions.reduce((a, p) => a + (p.pnl || 0), 0);
  const trips = wins + losses;
  const winRate = trips > 0 ? (wins / trips) * 100 : null;
  const best = symbols[0];
  const worst = symbols.length > 1 ? symbols[symbols.length - 1] : null;

  // ---- Today only ----
  const todayKey = dayKey(Date.now());
  const todayTrades = trades.filter((t) => dayKey(t.time) === todayKey).sort((a, b) => b.time - a.time);
  const todayBuys = todayTrades.filter((t) => t.side === "BUY").length;
  const todayCommission = todayTrades.reduce((a, t) => a + Math.abs(t.commission || 0), 0);
  const todayGross = todayTrades.reduce((a, t) => a + Math.abs(t.netAmount || t.price * t.quantity), 0);
  const todayRealized = byDayKey.get(todayKey) ?? 0;

  const maxAbsSym = Math.max(1, ...symbols.map((s) => Math.abs(s.realized)));
  const maxAbsPos = Math.max(1, ...positions.map((p) => Math.abs(p.pnl || 0)));

  // The archive only reaches back to when it started collecting (IBKR itself
  // exposes just ~7 days) — label the window honestly instead of "all time".
  const firstTradeMs = trades.reduce((a, t) => (t.time > 0 && t.time < a ? t.time : a), Infinity);
  const sinceLabel = Number.isFinite(firstTradeMs)
    ? `since ${new Date(firstTradeMs).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`
    : "archived";

  return (
    <div className="p-6 space-y-5">
      {mismatched.length > 0 && (
        <div className="rounded-2xl p-4 bg-warn/10 border border-warn/30 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warn shrink-0 mt-0.5" />
          <div className="text-[11.5px] leading-snug">
            <span className="font-semibold">These figures are not reliable right now.</span>{" "}
            <span className="text-muted-foreground">
              Walking the fills for{" "}
              <span className="font-semibold text-foreground">{mismatched.join(", ")}</span> ends on a
              position {brokerInfo().short} does not report holding, which means the history here
              does not reach back to where those positions were opened. Without the opening fills
              there is no cost basis, so the realized numbers for those symbols are wrong rather
              than merely incomplete. Everything else on this page is unaffected.
            </span>
          </div>
        </div>
      )}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-info" /> P&L Analysis
        </h1>
        <p className="text-sm text-muted-foreground">
          Where your profit and loss actually came from — closed round-trips from your FULL archived history plus your open positions.
        </p>
      </div>

      {/* ---- TODAY'S SESSION — same-day only ---- */}
      <section className="rounded-2xl glass p-5 border border-info/20">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-info" /> Today's Session
          </div>
          <span className="text-[11px] text-muted-foreground">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" })} · US market day</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Tile label="Trades today" value={String(todayTrades.length)} tone="muted" sub={`${todayBuys} buys · ${todayTrades.length - todayBuys} sells`} />
          <Tile label="Realized P&L today" value={signed(todayRealized)} tone={todayRealized >= 0 ? "bull" : "bear"} sub="closed round-trips" />
          <Tile label="Commissions today" value={`$${fmtMoney(todayCommission)}`} tone="muted" sub={`deducted by ${brokerInfo().short}`} />
          <Tile label="Gross traded today" value={`$${fmtMoney(todayGross, 0)}`} tone="muted" sub="buy + sell value" />
        </div>
        {todayTrades.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-3">No executions yet today.</div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin rounded-xl hairline">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-12 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground hairline-b bg-surface-1/60">
                <div className="col-span-2">Time</div>
                <div className="col-span-2">Symbol</div>
                <div className="col-span-1">Side</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-1 text-right">Comm.</div>
                <div className="col-span-2 text-right">Value</div>
              </div>
              {todayTrades.map((t) => (
                <div key={t.executionId} className="grid grid-cols-12 items-center px-3 py-2 hairline-b last:border-0 text-sm">
                  <div className="col-span-2 text-xs text-muted-foreground num whitespace-nowrap">
                    {new Date(t.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET
                  </div>
                  <div className="col-span-2 font-semibold">{t.symbol}</div>
                  <div className="col-span-1">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${t.side === "BUY" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{t.side}</span>
                  </div>
                  <div className="col-span-2 text-right num">{t.quantity}</div>
                  <div className="col-span-2 text-right num whitespace-nowrap">${fmtMoney(t.price)}</div>
                  <div className="col-span-1 text-right num text-warn whitespace-nowrap">${fmtMoney(Math.abs(t.commission || 0))}</div>
                  <div className="col-span-2 text-right num text-muted-foreground whitespace-nowrap">${fmtMoney(Math.abs(t.netAmount || t.price * t.quantity), 0)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---- Stat tiles (all-time archive) ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={`Realized P&L (${sinceLabel})`} value={signed(realizedTotal)} tone={realizedTotal >= 0 ? "bull" : "bear"} sub={`${trips} trips · net ${signed(realizedTotal - commissions)} after comm.`} />
        <Tile label="Unrealized P&L (open)" value={signed(unrealized)} tone={unrealized >= 0 ? "bull" : "bear"} sub={`${positions.length} open position${positions.length === 1 ? "" : "s"}`} />
        <Tile label="Win rate" value={winRate != null ? `${winRate.toFixed(0)}%` : "—"} tone={winRate != null && winRate >= 50 ? "bull" : "muted"} sub={trips > 0 ? `${wins}W · ${losses}L` : "no closed trades yet"} />
        <Tile label={`Commissions (${sinceLabel})`} value={`$${fmtMoney(commissions)}`} tone="muted" sub={`deducted by ${brokerInfo().short}`} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">Could not load executions from {brokerInfo().short}</div>
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
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best trade ({sinceLabel})</div>
                    <div className="text-sm font-semibold">{best.symbol} <span className="num text-bull">{signed(best.realized)}</span></div>
                  </div>
                </div>
              )}
              {worst && worst.realized < 0 && (
                <div className="rounded-2xl glass p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-bear/15 grid place-items-center"><TrendingDown className="h-4 w-4 text-bear" /></div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Worst trade ({sinceLabel})</div>
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
            <div className="text-sm font-semibold mb-1">Realized P&L by Stock</div>
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
            <p className="text-[11px] text-muted-foreground mb-3">Live mark-to-market from {brokerInfo().short} — this is what you'd realize if you closed now.</p>
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

          {/* ---- The broker's own number, for reference ---- */}
          <p className="text-[11px] text-muted-foreground">
            {brokerInfo().reportsRealizedPnl && (
              <>
                {brokerInfo().short} account realized P&L (today, their number): <span className={`num ${(summary?.realizedPnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{signed(summary?.realizedPnl ?? 0)}</span>.{" "}
              </>
            )}
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
