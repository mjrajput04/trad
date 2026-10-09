import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Cpu, Loader2, Lock, Octagon, Power, Radar, Save, ShieldCheck, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isControlAccount } from "@/lib/app-flags";
import { fmtMoney } from "@/lib/market-data";
import {
  closeEnginePosition, getEngineHistory, getEngineStatus, killEngine, setEngineConfig, setEngineMode,
  type EngineCandidate, type EngineConfig, type EngineMode, type EnginePosition, type EngineStatus,
} from "@/lib/api/engine";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/engine")({
  head: () => ({ meta: [{ title: "Engine · NOVA" }, { name: "robots", content: "noindex" }] }),
  component: EnginePage,
});

// Lab result the engine's defaults come from (5-min bars, 262 liquid US stocks,
// 2026-07-30 → 2026-10-08, IBKR fixed commissions + slippage, pessimistic fills).
const BACKTEST = {
  window: "Jul 30 – Oct 8, 2026 · 50 sessions",
  trades: 135, win: 63, pf: 1.45, net: 818, perDay: 19, maxDd: 187, worstDay: -128, bestDay: 193, mcl: 5,
  isWin: 58, oosWin: 68, isPf: 1.47, oosPf: 1.43,
};

const usd = (n: number, signed = false) =>
  `${signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : ""}$${fmtMoney(Math.abs(n))}`;
const pnlClass = (n: number) => (n > 0 ? "text-bull" : n < 0 ? "text-bear" : "text-muted-foreground");
const time = (t: number | null | undefined) =>
  t ? new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";

const PHASES = [
  { id: "premarket", label: "Pre-market" },
  { id: "scanning", label: "Scan 09:36" },
  { id: "deciding", label: "Entry 09:45" },
  { id: "managing", label: "Managing" },
  { id: "flattening", label: "Flatten" },
  { id: "done", label: "Done" },
];
const PHASE_INDEX: Record<string, number> = {
  premarket: 0, opening: 0, scanning: 1, deciding: 2, managing: 3, halted: 3, flattening: 4, done: 5,
};

function EnginePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const control = isControlAccount(user?.email);

  // Private page: every other account is sent away (the engine API refuses
  // them too, so this is about not showing it, not about security).
  useEffect(() => {
    if (user && !control) navigate({ to: "/alerts", replace: true });
  }, [user, control, navigate]);

  const { data: st, error, isLoading } = useQuery({
    queryKey: ["engine-status"],
    queryFn: getEngineStatus,
    refetchInterval: 2_000,
    enabled: control,
    retry: 1,
  });
  const { data: history = [] } = useQuery({
    queryKey: ["engine-history"],
    queryFn: getEngineHistory,
    refetchInterval: 60_000,
    enabled: control,
  });

  if (!control) return null;

  if (isLoading) {
    return (
      <div className="p-10 grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (error || !st) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto rounded-2xl glass p-8 text-center">
          <AlertTriangle className="h-7 w-7 text-warn mx-auto mb-3" />
          <div className="text-base font-semibold mb-1">Engine not reachable</div>
          <div className="text-xs text-muted-foreground">
            {(error as Error)?.message ?? "No response"} — the nova-engine service on the server may be stopped.
          </div>
        </div>
      </div>
    );
  }

  return <EngineDashboard st={st} history={history} />;
}

function EngineDashboard({ st, history }: { st: EngineStatus; history: Awaited<ReturnType<typeof getEngineHistory>> }) {
  const qc = useQueryClient();
  const [armOpen, setArmOpen] = useState(false);
  const day = st.day;
  const total = day.realized + day.unrealized;
  const lossUsed = Math.max(0, -total) / st.config.dailyLossLimit;

  const refresh = (s: EngineStatus) => qc.setQueryData(["engine-status"], s);
  const mode = useMutation({
    mutationFn: ({ m, confirm }: { m: EngineMode; confirm?: string }) => setEngineMode(m, confirm),
    onSuccess: (s) => {
      refresh(s);
      toast.success(`Engine mode: ${s.mode.toUpperCase()}`);
      setArmOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const kill = useMutation({
    mutationFn: killEngine,
    onSuccess: (s) => { refresh(s); toast.warning("Kill switch: everything flattened, engine OFF"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onMode = (m: EngineMode) => {
    if (m === st.mode) return;
    if (m === "live") setArmOpen(true);
    else mode.mutate({ m });
  };

  const open = day.positions.filter((p) => p.status === "open" || p.status === "pending");

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">NOVA Engine</h1>
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 hairline px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" /> Private
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Stocks-in-Play scalper · gap + first 15 min + SPY aligned · quick ${st.config.targetUsd} targets · runs on the server
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitch mode={st.mode} busy={mode.isPending} onChange={onMode} />
          <button
            onClick={() => {
              if (window.confirm("Kill switch: close every engine position now and turn the engine OFF?")) kill.mutate();
            }}
            disabled={kill.isPending}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-bear/15 text-bear hover:bg-bear/25 text-xs font-semibold transition disabled:opacity-60"
          >
            {kill.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Octagon className="h-3.5 w-3.5" />}
            Kill
          </button>
        </div>
      </div>

      {st.mode === "live" && (
        <div className="rounded-xl border border-bear/40 bg-bear/10 px-4 py-2.5 text-xs text-bear font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          LIVE — the engine sends real IBKR orders with your money. Each entry is a bracket (stop + target) held at IBKR.
        </div>
      )}
      {day.halted && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-xs text-warn font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" /> Halted for today: {day.haltReason}
        </div>
      )}

      {/* ---- day timeline ---- */}
      <PhaseBar phase={day.phase} st={st} />

      {/* ---- KPIs ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Today P&L" sub={`realized ${usd(day.realized, true)} · open ${usd(day.unrealized, true)}`}>
          <span className={cn("text-2xl font-semibold num", pnlClass(total))}>{usd(total, true)}</span>
        </Tile>
        <Tile label="Trades" sub={day.entryMode ? `entered in ${day.entryMode.toUpperCase()}` : "entries at 09:45 ET"}>
          <span className="text-2xl font-semibold num">{day.wins + day.losses}</span>
          <span className="text-xs text-muted-foreground ml-2 num">
            <span className="text-bull">{day.wins}W</span> · <span className="text-bear">{day.losses}L</span> · {open.length} open
          </span>
        </Tile>
        <Tile label="Daily loss limit" sub={`halts & flattens at −$${st.config.dailyLossLimit}`}>
          <div className="w-full">
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", lossUsed > 0.66 ? "bg-bear" : lossUsed > 0.33 ? "bg-warn" : "bg-bull")}
                style={{ width: `${Math.min(100, lossUsed * 100)}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 num">{Math.round(Math.min(1, lossUsed) * 100)}% used</div>
          </div>
        </Tile>
        <Tile label="Market" sub={day.spy ? `SPY first 15m ${day.spy.chgPct > 0 ? "+" : ""}${day.spy.chgPct}%` : "SPY direction at 09:45"}>
          <span className={cn("text-2xl font-semibold", day.spy ? (day.spy.dir > 0 ? "text-bull" : day.spy.dir < 0 ? "text-bear" : "") : "text-muted-foreground")}>
            {day.spy ? (day.spy.dir > 0 ? "Longs" : day.spy.dir < 0 ? "Shorts" : "No trade") : "—"}
          </span>
        </Tile>
      </div>

      {/* ---- positions ---- */}
      <section className="rounded-2xl glass overflow-hidden">
        <div className="px-5 py-3 hairline-b flex items-center justify-between">
          <div className="text-sm font-semibold">Today&apos;s trades</div>
          <div className="text-[11px] text-muted-foreground">stop = other side of the 15-min range · flat by {st.schedule.flatten} ET</div>
        </div>
        {day.positions.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            {day.decided ? "No trade today — nothing passed every filter." : `Entries are placed at ${st.schedule.entry} ET.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground hairline-b">
                  <th className="text-left font-medium px-5 py-2">Symbol</th>
                  <th className="text-right font-medium px-3 py-2">Qty</th>
                  <th className="text-right font-medium px-3 py-2">Entry</th>
                  <th className="text-right font-medium px-3 py-2">Last / Exit</th>
                  <th className="font-medium px-3 py-2 w-[180px]">Stop → Target</th>
                  <th className="text-right font-medium px-3 py-2">P&amp;L</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {day.positions.map((p) => <PositionRow key={p.id} p={p} onClosed={refresh} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-5 gap-5">
        {/* ---- stocks in play ---- */}
        <section className="lg:col-span-3 rounded-2xl glass overflow-hidden">
          <div className="px-5 py-3 hairline-b flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Radar className="h-4 w-4 text-primary" /> Stocks in play
            </div>
            <div className="text-[11px] text-muted-foreground num">
              {day.scanned ? `${day.universe} movers scanned at ${time(day.scanAt)} ET` : `scan runs at ${st.schedule.scan} ET`}
            </div>
          </div>
          <CandidateTable rows={day.candidates} />
        </section>

        {/* ---- settings ---- */}
        <section className="lg:col-span-2 rounded-2xl glass overflow-hidden">
          <div className="px-5 py-3 hairline-b text-sm font-semibold">Settings</div>
          <SettingsForm config={st.config} onSaved={refresh} />
        </section>
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <section className="lg:col-span-3 rounded-2xl glass overflow-hidden">
          <div className="px-5 py-3 hairline-b text-sm font-semibold">Track record</div>
          <TrackRecord history={history} />
        </section>
        <section className="lg:col-span-2 rounded-2xl glass overflow-hidden flex flex-col">
          <div className="px-5 py-3 hairline-b flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" /> Activity</div>
            <GatewayBadge st={st} />
          </div>
          <div className="max-h-[360px] overflow-y-auto scrollbar-thin px-5 py-3 space-y-1.5 font-mono text-[11px]">
            {st.log.length === 0 && <div className="text-muted-foreground">No events yet.</div>}
            {[...st.log].reverse().map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{time(l.t)}</span>
                <span className={cn(
                  l.level === "error" ? "text-bear" : l.level === "warn" ? "text-warn" : l.level === "trade" ? "text-primary" : "text-foreground/80",
                )}>{l.msg}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ArmLiveDialog
        open={armOpen}
        onOpenChange={setArmOpen}
        busy={mode.isPending}
        config={st.config}
        onArm={(confirm) => mode.mutate({ m: "live", confirm })}
      />
    </div>
  );
}

function ModeSwitch({ mode, busy, onChange }: { mode: EngineMode; busy: boolean; onChange: (m: EngineMode) => void }) {
  const opts: { m: EngineMode; label: string; on: string }[] = [
    { m: "off", label: "Off", on: "bg-surface-2 text-foreground" },
    { m: "paper", label: "Paper", on: "bg-primary/15 text-primary" },
    { m: "live", label: "Live", on: "bg-bear/20 text-bear" },
  ];
  return (
    <div className="inline-flex h-9 items-center rounded-lg hairline bg-surface-1 p-0.5">
      {opts.map((o) => (
        <button
          key={o.m}
          disabled={busy}
          onClick={() => onChange(o.m)}
          className={cn(
            "h-8 px-3 rounded-md text-xs font-semibold transition inline-flex items-center gap-1.5 disabled:opacity-60",
            mode === o.m ? o.on : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.m === "live" && <Power className="h-3 w-3" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PhaseBar({ phase, st }: { phase: string; st: EngineStatus }) {
  const idx = PHASE_INDEX[phase] ?? -1;
  return (
    <div className="rounded-2xl glass px-4 py-3 flex items-center gap-3 overflow-x-auto scrollbar-none">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{st.day.key}</span>
      <div className="flex items-center gap-1.5 flex-1 min-w-max">
        {phase === "closed" ? (
          <span className="text-xs text-muted-foreground">Market closed — next session runs automatically (scan 09:36, entries 09:45, flat {st.schedule.flatten} ET).</span>
        ) : (
          PHASES.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap",
                  i === idx ? "bg-primary/15 text-primary" : i < idx ? "text-foreground/70" : "text-muted-foreground",
                )}
              >
                {i === idx && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                {p.label}
              </span>
              {i < PHASES.length - 1 && <span className="h-px w-4 bg-[var(--line)]" />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Tile({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl glass p-4 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline min-h-[32px]">{children}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>}
    </div>
  );
}

function GatewayBadge({ st }: { st: EngineStatus }) {
  const ok = st.gateway.authenticated;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold", ok ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-bull" : "bg-bear")} />
      IBKR {ok ? "connected" : "not authenticated"}
    </span>
  );
}

function PositionRow({ p, onClosed }: { p: EnginePosition; onClosed: (s: EngineStatus) => void }) {
  const close = useMutation({
    mutationFn: () => closeEnginePosition(p.id),
    onSuccess: (s) => { onClosed(s); toast.success(`${p.symbol} closed`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const live = p.status === "open" || p.status === "pending";
  const px = p.status === "closed" ? p.exit ?? p.last : p.last;
  // where the price sits between stop (0%) and target (100%)
  const span = p.target - p.stop;
  const pos = span !== 0 ? Math.min(1, Math.max(0, (px - p.stop) / span)) : 0.5;
  const entryAt = span !== 0 && p.entry ? Math.min(1, Math.max(0, (p.entry - p.stop) / span)) : 0.5;

  return (
    <tr className="hairline-b last:border-0">
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{p.symbol}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", p.dir > 0 ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>
            {p.dir > 0 ? "LONG" : "SHORT"}
          </span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", p.kind === "live" ? "bg-bear/10 text-bear" : "bg-surface-2 text-muted-foreground")}>
            {p.kind.toUpperCase()}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right num">{p.qty}</td>
      <td className="px-3 py-2.5 text-right num">{p.entry ? fmtMoney(p.entry) : "…"}</td>
      <td className="px-3 py-2.5 text-right num">{fmtMoney(px)}</td>
      <td className="px-3 py-2.5">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-bear/30 via-surface-2 to-bull/30">
          <span className="absolute top-1/2 -translate-y-1/2 h-3 w-px bg-muted-foreground" style={{ left: `${entryAt * 100}%` }} />
          <span
            className={cn("absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full border-2 border-background", p.pnl >= 0 ? "bg-bull" : "bg-bear")}
            style={{ left: `${pos * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground num mt-1">
          <span>{fmtMoney(p.stop)}</span>
          <span>{fmtMoney(p.target)}</span>
        </div>
      </td>
      <td className={cn("px-3 py-2.5 text-right font-semibold num", pnlClass(p.pnl))}>{usd(p.pnl, true)}</td>
      <td className="px-3 py-2.5 text-xs">
        {live ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> {p.status}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {p.why || p.status} · {time(p.closed)}
          </span>
        )}
      </td>
      <td className="px-5 py-2.5 text-right">
        {live && (
          <button
            onClick={() => window.confirm(`Close ${p.symbol} now at market?`) && close.mutate()}
            disabled={close.isPending}
            className="h-7 px-2.5 rounded-md hairline bg-surface-1 hover:bg-surface-2 text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
          >
            {close.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Close
          </button>
        )}
      </td>
    </tr>
  );
}

const STATUS_STYLE: Record<EngineCandidate["status"], string> = {
  watch: "bg-primary/10 text-primary",
  qualified: "bg-bull/15 text-bull",
  picked: "bg-warn/15 text-warn",
  entered: "bg-bull/20 text-bull",
  filtered: "bg-surface-2 text-muted-foreground",
  error: "bg-bear/15 text-bear",
};

function CandidateTable({ rows }: { rows: EngineCandidate[] }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => {
    const rank = { entered: 0, picked: 1, qualified: 2, watch: 3, error: 4, filtered: 5 } as const;
    return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || b.rv - a.rv);
  }, [rows]);
  const visible = showAll ? sorted : sorted.filter((r) => r.status !== "filtered").concat(sorted.filter((r) => r.status === "filtered").slice(0, 8));

  if (!rows.length) {
    return <div className="px-5 py-8 text-center text-sm text-muted-foreground">The movers list fills in right after the opening 5-minute bar.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground hairline-b">
            <th className="text-left font-medium px-5 py-2">Symbol</th>
            <th className="text-right font-medium px-3 py-2">Gap</th>
            <th className="text-right font-medium px-3 py-2">Rel. vol</th>
            <th className="text-right font-medium px-3 py-2">First 15m</th>
            <th className="text-left font-medium px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.conid} className="hairline-b last:border-0">
              <td className="px-5 py-2">
                <div className="font-semibold">{c.symbol}</div>
                <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{c.name}</div>
              </td>
              <td className={cn("px-3 py-2 text-right num", pnlClass(c.gapPct))}>{c.gapPct > 0 ? "+" : ""}{c.gapPct.toFixed(1)}%</td>
              <td className="px-3 py-2 text-right num">{c.rv.toFixed(1)}×</td>
              <td className={cn("px-3 py-2 text-right num", pnlClass(c.move15 ?? 0))}>
                {c.move15 != null ? `${c.move15 > 0 ? "+" : ""}${c.move15.toFixed(2)}%` : "—"}
              </td>
              <td className="px-3 py-2">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS_STYLE[c.status])}>{c.status}</span>
                {c.reason && <span className="ml-1.5 text-[11px] text-muted-foreground">{c.reason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > visible.length && (
        <button onClick={() => setShowAll(true)} className="w-full py-2 text-[11px] text-muted-foreground hover:text-foreground hairline-t">
          Show all {sorted.length}
        </button>
      )}
    </div>
  );
}

const FIELDS: { key: keyof EngineConfig; label: string; hint: string; step: number }[] = [
  { key: "riskUsd", label: "Risk per trade ($)", hint: "lost if the stop hits; sizes the position", step: 5 },
  { key: "targetUsd", label: "Profit target ($)", hint: "tested best at 0.4–1.0× risk", step: 5 },
  { key: "topN", label: "Max trades / day", hint: "top N by relative volume", step: 1 },
  { key: "dailyLossLimit", label: "Daily loss limit ($)", hint: "halts and flattens the day", step: 10 },
  { key: "maxNotional", label: "Max position ($)", hint: "notional cap per trade", step: 500 },
  { key: "minRv", label: "Min relative volume", hint: "first 5 min vs its average", step: 0.5 },
  { key: "minGapPct", label: "Min gap (%)", hint: "opening gap, same side as trade", step: 0.25 },
];

function SettingsForm({ config, onSaved }: { config: EngineConfig; onSaved: (s: EngineStatus) => void }) {
  const [draft, setDraft] = useState<EngineConfig>(config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  useEffect(() => { if (!dirty) setDraft(config); }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => setEngineConfig(draft),
    onSuccess: (s) => { onSaved(s); setDraft(s.config); toast.success("Engine settings saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ratio = draft.targetUsd / draft.riskUsd;

  return (
    <div className="p-5 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block min-w-0">
            <span className="text-[11px] text-muted-foreground">{f.label}</span>
            <input
              type="number"
              step={f.step}
              value={draft[f.key] as number}
              onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
              className="mt-1 w-full h-9 rounded-lg hairline bg-surface-1 px-2.5 text-sm num focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground/80">{f.hint}</span>
          </label>
        ))}
        <label className="block min-w-0">
          <span className="text-[11px] text-muted-foreground">Direction</span>
          <select
            value={draft.side}
            onChange={(e) => setDraft({ ...draft, side: e.target.value as EngineConfig["side"] })}
            className="mt-1 w-full h-9 rounded-lg hairline bg-surface-1 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="both">Long + short</option>
            <option value="long">Long only</option>
          </select>
          <span className="text-[10px] text-muted-foreground/80">shorts follow a falling SPY</span>
        </label>
      </div>
      {(ratio < 0.4 || ratio > 1) && (
        <div className="text-[11px] text-warn">
          Target is {ratio.toFixed(2)}× risk — outside the 0.4–1.0× band that held up in testing.
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {dirty && (
          <button onClick={() => setDraft(config)} className="h-8 px-3 rounded-lg hairline bg-surface-1 text-xs font-medium">
            Reset
          </button>
        )}
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="h-8 px-3 rounded-lg bg-primary text-background text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
      </div>
    </div>
  );
}

function TrackRecord({ history }: { history: Awaited<ReturnType<typeof getEngineHistory>> }) {
  const traded = history.filter((d) => d.trades > 0);
  const trades = traded.flatMap((d) => d.positions);
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;

  return (
    <div className="p-5 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-1 hairline p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Backtest · {BACKTEST.window}</div>
          <div className="mt-1 text-lg font-semibold num">
            {BACKTEST.win}% win · PF {BACKTEST.pf}
          </div>
          <div className="text-[11px] text-muted-foreground num mt-0.5">
            {BACKTEST.trades} trades · {usd(BACKTEST.net, true)} at $50 risk (≈{usd(BACKTEST.perDay)}/day) · max DD {usd(BACKTEST.maxDd)} · worst day {usd(BACKTEST.worstDay)} · max {BACKTEST.mcl} losses in a row
          </div>
          <div className="text-[11px] text-muted-foreground num mt-0.5">
            first half {BACKTEST.isWin}% / PF {BACKTEST.isPf} · second half {BACKTEST.oosWin}% / PF {BACKTEST.oosPf}
          </div>
        </div>
        <div className="rounded-xl bg-surface-1 hairline p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Forward · engine journal</div>
          {trades.length ? (
            <>
              <div className={cn("mt-1 text-lg font-semibold num", pnlClass(net))}>
                {usd(net, true)} · {Math.round((100 * wins) / trades.length)}% win
              </div>
              <div className="text-[11px] text-muted-foreground num mt-0.5">
                {trades.length} trades over {traded.length} session{traded.length === 1 ? "" : "s"} (paper + live)
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">No finished sessions yet — paper results collect here day by day.</div>
          )}
        </div>
      </div>
      {traded.length > 0 && (
        <div className="space-y-1">
          {[...traded].reverse().slice(0, 15).map((d) => (
            <div key={d.key} className="flex items-center justify-between text-xs py-1 hairline-b last:border-0">
              <span className="num text-muted-foreground w-24">{d.key}</span>
              <span className="text-[10px] uppercase text-muted-foreground w-12">{d.mode}</span>
              <span className="flex-1 truncate text-muted-foreground">
                {d.positions.map((t) => `${t.symbol}${t.dir > 0 ? "▲" : "▼"}`).join(" ")}
              </span>
              <span className="num w-14 text-right">{d.wins}/{d.trades}</span>
              <span className={cn("num w-20 text-right font-semibold", pnlClass(d.pnl))}>{usd(d.pnl, true)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        No setting makes a trade risk-free: every trade has a hard stop and can lose up to the risk amount.
        The test covers only 50 sessions, so treat the numbers as a starting estimate and let the paper
        journal confirm them before going live.
      </p>
    </div>
  );
}

function ArmLiveDialog({
  open, onOpenChange, busy, config, onArm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  config: EngineConfig;
  onArm: (confirm: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => { if (!open) setText(""); }, [open]);
  const worst = Math.min(config.dailyLossLimit, config.riskUsd * config.topN);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-bear">
            <Power className="h-4 w-4" /> Arm live trading
          </DialogTitle>
          <DialogDescription>
            From the next 09:45 ET entry the engine sends real orders to IBKR with your money.
          </DialogDescription>
        </DialogHeader>
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
          <li>Up to {config.topN} trades a day, each risking about ${config.riskUsd}; target ${config.targetUsd}.</li>
          <li>Worst normal day ≈ −${worst} (daily loss limit ${config.dailyLossLimit}). Gaps through a stop can lose more.</li>
          <li>Each entry is a bracket at IBKR, so the stop and target stay in place even if the engine stops.</li>
          <li>The engine falls back to Paper after a server restart; you re-arm Live by hand.</li>
        </ul>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Type LIVE to confirm</span>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 w-full h-9 rounded-lg hairline bg-surface-1 px-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-1 focus:ring-bear"
          />
        </label>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="h-9 px-4 rounded-lg hairline bg-surface-1 text-xs font-medium">
            Cancel
          </button>
          <button
            onClick={() => onArm(text.trim())}
            disabled={text.trim() !== "LIVE" || busy}
            className="h-9 px-4 rounded-lg bg-bear text-background text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Arm live
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
