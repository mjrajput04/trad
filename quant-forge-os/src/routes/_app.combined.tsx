// Both desks on one page.
//
// Every other page in here shows the broker you have selected, which is right
// for trading and useless for the one question that spans them: what has this
// money done in total. Two accounts at two firms, so the only way to answer it
// is to read both and add them up.
//
// The one rule this page lives by: a total built from one broker because the
// other had no session is not a smaller total, it is a wrong one. So each side
// reports whether it could be read, and the combined figure refuses to call
// itself complete when it could not be.

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Layers, Loader2, Scale, TrendingUp } from "lucide-react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getBrokerHistory, getBrokerPositions } from "@/lib/trade-store";
import { computeRealized, dayKey, dayLabel } from "@/lib/pnl";
import { BROKERS, type BrokerId } from "@/lib/broker";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/combined")({
  head: () => ({
    meta: [
      { title: "Combined P&L · NOVA" },
      { name: "description", content: "Every broker's profit and loss in one total." },
    ],
  }),
  component: Combined,
});

const BULL = "var(--bull)";
const BEAR = "var(--bear)";
const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${fmtMoney(Math.abs(n))}`;
const tone = (n: number) => (n >= 0 ? "text-bull" : "text-bear");

interface Side {
  broker: BrokerId;
  name: string;
  short: string;
  realized: number;
  unrealized: number | null;
  trips: number;
  wins: number;
  losses: number;
  symbols: Array<{ symbol: string; realized: number; trips: number }>;
  /** Realized P&L per ET day, for the combined chart. */
  byDay: Map<string, number>;
  /** A day key → one timestamp in it, so the chart can label it. */
  dayStamp: Map<string, number>;
  liveOk: boolean;
  archiveOk: boolean;
  error: string | null;
}

async function loadSide(broker: BrokerId): Promise<Side> {
  const info = BROKERS.find((b) => b.id === broker)!;
  const [history, positions] = await Promise.all([
    getBrokerHistory(broker),
    getBrokerPositions(broker),
  ]);
  const r = computeRealized(history.trades);

  // The chart needs a timestamp per day as well as the day's total, and
  // computeRealized only hands back labels — so key off the trades again.
  const dayStamp = new Map<string, number>();
  for (const t of history.trades) {
    const k = dayKey(t.time);
    if (!dayStamp.has(k)) dayStamp.set(k, t.time);
  }

  return {
    broker,
    name: info.name,
    short: info.short,
    realized: r.total,
    // null, not 0: "we could not ask" and "nothing open" are different answers.
    unrealized: positions === null ? null : positions.reduce((a, p) => a + (p.pnl || 0), 0),
    trips: r.wins + r.losses,
    wins: r.wins,
    losses: r.losses,
    symbols: r.symbols.map((s) => ({ symbol: s.symbol, realized: s.realized, trips: s.trips })),
    byDay: r.byDayKey,
    dayStamp,
    liveOk: history.liveOk,
    archiveOk: history.archiveOk,
    error: history.error,
  };
}

function Tile({
  label,
  value,
  sub,
  valueTone,
}: {
  label: string;
  value: string;
  sub?: string;
  valueTone?: string;
}) {
  return (
    <div className="rounded-2xl glass hairline p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold num ${valueTone ?? ""}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function Combined() {
  const { data: sides, isLoading, isError, error } = useQuery({
    queryKey: ["combined-pnl"],
    queryFn: () => Promise.all(BROKERS.map((b) => loadSide(b.id))),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-10 grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !sides) {
    return (
      <div className="p-6">
        <div className="rounded-2xl glass hairline p-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warn shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Could not build the combined view</div>
            <div className="text-xs text-muted-foreground mt-1">
              {(error as any)?.message ?? "Neither broker could be read."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const realized = sides.reduce((a, s) => a + s.realized, 0);
  const unrealizedKnown = sides.filter((s) => s.unrealized !== null);
  const unrealized = unrealizedKnown.reduce((a, s) => a + (s.unrealized ?? 0), 0);
  const trips = sides.reduce((a, s) => a + s.trips, 0);
  const wins = sides.reduce((a, s) => a + s.wins, 0);
  const winRate = trips > 0 ? (wins / trips) * 100 : null;

  // A side that could not be read at all contributes nothing and makes the
  // total a guess. Name those plainly rather than letting the number stand.
  const incomplete = sides.filter((s) => !s.liveOk || !s.archiveOk);

  // Combined daily P&L: add the brokers together day by day.
  const dayTotals = new Map<string, number>();
  const stamps = new Map<string, number>();
  for (const s of sides) {
    for (const [k, v] of s.byDay) dayTotals.set(k, (dayTotals.get(k) ?? 0) + v);
    for (const [k, t] of s.dayStamp) if (!stamps.has(k)) stamps.set(k, t);
  }
  const daily = [...dayTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, pnl]) => ({
      label: stamps.has(k) ? dayLabel(stamps.get(k)!) : k.slice(5),
      pnl: Number(pnl.toFixed(2)),
    }));

  // One merged leaderboard. A symbol traded at both desks gets one row, so the
  // figure is what that name earned you, not what it earned you at one firm.
  const bySymbol = new Map<string, { symbol: string; realized: number; trips: number; desks: Set<string> }>();
  for (const s of sides) {
    for (const sym of s.symbols) {
      const cur =
        bySymbol.get(sym.symbol) ?? { symbol: sym.symbol, realized: 0, trips: 0, desks: new Set<string>() };
      cur.realized += sym.realized;
      cur.trips += sym.trips;
      cur.desks.add(s.short);
      bySymbol.set(sym.symbol, cur);
    }
  }
  const leaderboard = [...bySymbol.values()].sort((a, b) => b.realized - a.realized);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Combined P&amp;L
        </h1>
        <p className="text-sm text-muted-foreground">
          Every broker added together — realized to date, and what is still open.
        </p>
      </div>

      {incomplete.length > 0 && (
        <div className="rounded-2xl p-4 bg-warn/10 border border-warn/30 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warn shrink-0 mt-0.5" />
          <div className="text-[11.5px] leading-snug">
            <span className="font-semibold">This total is not complete.</span>{" "}
            <span className="text-muted-foreground">
              {incomplete
                .map((s) => `${s.short} — ${s.error ?? (s.liveOk ? "archive unavailable" : "no session")}`)
                .join("; ")}
              . Reconnect that broker and this page will add it in.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Realized to date"
          value={signed(realized)}
          valueTone={tone(realized)}
          sub={`${trips} round trip${trips === 1 ? "" : "s"} across ${sides.length} brokers`}
        />
        <Tile
          label="Open P&L"
          value={unrealizedKnown.length ? signed(unrealized) : "—"}
          valueTone={unrealizedKnown.length ? tone(unrealized) : undefined}
          sub={
            unrealizedKnown.length === sides.length
              ? "mark-to-market, both brokers"
              : unrealizedKnown.length
                ? `${unrealizedKnown.map((s) => s.short).join(" + ")} only`
                : "no broker could be asked"
          }
        />
        <Tile
          label="Realized + open"
          value={unrealizedKnown.length ? signed(realized + unrealized) : signed(realized)}
          valueTone={tone(realized + unrealized)}
          sub="everything, closed and still running"
        />
        <Tile
          label="Win rate"
          value={winRate === null ? "—" : `${winRate.toFixed(0)}%`}
          sub={winRate === null ? "no closed trips yet" : `${wins} won · ${trips - wins} lost`}
        />
      </div>

      {/* ---- per broker ---- */}
      <div className="grid md:grid-cols-2 gap-3">
        {sides.map((s) => (
          <div key={s.broker} className="rounded-2xl glass hairline p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-semibold text-sm truncate">{s.name}</span>
              </div>
              {!s.liveOk || !s.archiveOk ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-warn/15 text-warn font-semibold shrink-0">
                  {s.liveOk ? "archive only" : "not connected"}
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-bull/15 text-bull font-semibold shrink-0">
                  read
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Realized</div>
                <div className={`num text-base font-semibold ${tone(s.realized)}`}>{signed(s.realized)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Open</div>
                <div
                  className={`num text-base font-semibold ${s.unrealized === null ? "" : tone(s.unrealized)}`}
                >
                  {s.unrealized === null ? "—" : signed(s.unrealized)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Trips</div>
                <div className="num text-base font-semibold">{s.trips}</div>
              </div>
            </div>

            {s.error ? (
              <div className="mt-2 text-[10.5px] text-warn leading-snug">{s.error}</div>
            ) : s.trips === 0 ? (
              <div className="mt-2 text-[10.5px] text-muted-foreground">
                Nothing has been opened and closed here yet.
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* ---- combined daily ---- */}
      {daily.length > 0 && (
        <div className="rounded-2xl glass hairline p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Realized by day — both brokers</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={52} />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    fontSize: 11,
                  }}
                  formatter={(v: any) => signed(Number(v))}
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {daily.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? BULL : BEAR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ---- merged leaderboard ---- */}
      {leaderboard.length > 0 && (
        <div className="rounded-2xl glass hairline p-4">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">By symbol — across every broker</span>
          </div>
          <div className="grid grid-cols-12 text-[10px] uppercase tracking-wider text-muted-foreground pb-2">
            <div className="col-span-4">Symbol</div>
            <div className="col-span-3">Traded at</div>
            <div className="col-span-2 text-right">Trips</div>
            <div className="col-span-3 text-right">Realized</div>
          </div>
          <div className="space-y-1">
            {leaderboard.map((s) => (
              <div key={s.symbol} className="grid grid-cols-12 items-center text-[12px] py-1.5 border-t border-border/40">
                <div className="col-span-4 font-semibold">{s.symbol}</div>
                <div className="col-span-3 text-[10.5px] text-muted-foreground">
                  {[...s.desks].join(" + ")}
                </div>
                <div className="col-span-2 text-right num text-muted-foreground">{s.trips}</div>
                <div className={`col-span-3 text-right num font-semibold ${tone(s.realized)}`}>
                  {signed(s.realized)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Realized counts only quantity that was both opened and closed in what the brokers and the
        archive hold, matched against the position's average cost — the way a broker reports it.
        Anything opened before that has no cost basis here and is left out rather than guessed.
      </p>
    </div>
  );
}
