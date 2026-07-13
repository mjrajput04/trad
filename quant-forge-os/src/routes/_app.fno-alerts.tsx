import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Sparkles, Loader2, Trophy, Clock, Gauge, Zap, TrendingDown,
} from "lucide-react";
import { useFnoSignals, type FnoSignal } from "@/lib/fno-signals";
import { getTsBacktest, type TsBacktest, type TsAlert } from "@/lib/api/alerts";
import { OptionTradeModal, fmtExpiry } from "@/components/OptionTradeModal";
import { Level, LevelBar } from "@/components/TradeLevels";
import { type OptionContract, type OptionQuote } from "@/lib/api/ibkr";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/fno-alerts")({
  head: () => ({ meta: [{ title: "AI F&O Alerts · NOVA" }, { name: "description", content: "Live AI options signals — each a backtested stock setup expressed as a call or put, with premium entry / target / stop." }] }),
  component: FnoAlerts,
});

const money = (n?: number) => `$${fmtMoney(Number(n) || 0)}`;
const pctOf = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : 0);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

function FnoAlerts() {
  const { signals, best, isFetching, marketFalling, indexAvg, updated, marketOpen, closedUnderlying } = useFnoSignals();
  const { data: backtest } = useQuery({ queryKey: ["ts-backtest"], queryFn: getTsBacktest, refetchInterval: 300_000 });
  const [trade, setTrade] = useState<{ symbol: string; c: OptionContract; q?: OptionQuote; stop?: number; target?: number } | null>(null);

  const openTrade = (s: FnoSignal) =>
    setTrade({ symbol: s.underlying, c: s.contract, q: s.quote, stop: s.ready ? s.stop : undefined, target: s.ready ? s.target : undefined });

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-info" /> AI F&O Alerts
          </h1>
          <p className="text-sm text-muted-foreground">
            Options signals — each a working stock setup expressed as a call/put with premium entry, target &amp; stop.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${marketOpen ? "bg-bull/15 text-bull" : "bg-surface-2 text-muted-foreground"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${marketOpen ? "bg-bull animate-pulse" : "bg-muted-foreground"}`} />
            {marketOpen ? "Market Open" : "Market Closed"}
          </span>
          {updated && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {timeAgo(updated)}
            </span>
          )}
        </div>
      </div>

      {/* Best F&O play */}
      {best && <FnoBest s={best} onTrade={() => openTrade(best)} />}

      {/* Signals */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold">F&O Signals</h2>
          <span className="text-[11px] text-muted-foreground">
            {isFetching && signals.length === 0 ? "resolving contracts…" : `${signals.length} working · from the same 5-gate engine`}
          </span>
        </div>
        {signals.length === 0 ? (
          isFetching ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="rounded-2xl glass p-8 text-center text-muted-foreground text-sm">
              No strong F&O setups right now. Quality over quantity — a call appears when a stock setup is working,
              a SPY put only when the market is genuinely falling.
            </div>
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {signals.map((s) => <FnoCard key={s.key} s={s} onTrade={() => openTrade(s)} />)}
          </div>
        )}
      </section>

      {/* Honest track record */}
      {backtest && <FnoRealityCheck b={backtest} active={signals.length} closed={closedUnderlying} marketFalling={marketFalling} indexAvg={indexAvg} />}

      {trade && (
        <OptionTradeModal symbol={trade.symbol} contract={trade.c} quote={trade.q} defaultStop={trade.stop} defaultTarget={trade.target} onClose={() => setTrade(null)} />
      )}
    </div>
  );
}

function Levels({ s }: { s: FnoSignal }) {
  if (!s.ready) return <div className="text-[11px] text-muted-foreground py-2">Waiting for live premium…</div>;
  return (
    <>
      <div className="flex gap-2">
        <Level label="Premium" value={s.premium} tone="info" />
        <Level label="Target ≈" value={s.target} sub={signed(pctOf(s.premium, s.target))} tone="bull" />
        <Level label="Stop ≈" value={s.stop} sub={signed(pctOf(s.premium, s.stop))} tone="bear" />
      </div>
      <LevelBar entry={s.premium} target={s.target} stop={s.stop} now={s.quote?.last || s.premium} />
    </>
  );
}

function Meta({ s }: { s: FnoSignal }) {
  return (
    <div className="text-[11px] text-muted-foreground">
      ${s.contract.strike} strike · exp {fmtExpiry(s.contract.maturityDate)} · Δ {s.quote?.delta ? s.quote.delta.toFixed(2) : "—"}
      {s.underlyingQuote?.last ? <> · {s.underlying} {money(s.underlyingQuote.last)}</> : null}
      {s.iv ? <> · IV {s.iv.toFixed(0)}%</> : null}
    </div>
  );
}

function FnoBest({ s, onTrade }: { s: FnoSignal; onTrade: () => void }) {
  const isCall = s.right === "C";
  return (
    <div className="rounded-2xl glass p-5 relative overflow-hidden">
      <div className={`absolute -top-16 -right-10 h-48 w-48 rounded-full blur-3xl ${isCall ? "bg-bull/10" : "bg-bear/10"}`} />
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-warn" />
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-warn">Best F&O Play</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <Link to="/stock/$symbol" params={{ symbol: s.underlying }} className={`text-2xl font-bold hover:text-primary transition ${isCall ? "text-bull" : "text-bear"}`} title="Open chart">
              {s.label}
            </Link>
            {s.score != null && <span className="rounded-md bg-primary/15 text-primary text-[11px] font-bold px-2 py-0.5">Score {Math.round(s.score)}</span>}
          </div>
          <div className="mt-2"><Meta s={s} /></div>
          {s.reasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.reasons.slice(0, 4).map((r, i) => (
                <span key={i} className="text-[11px] rounded-md bg-surface-2 px-2 py-0.5 text-muted-foreground">{r}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-3 w-full sm:w-auto sm:min-w-[300px]">
          <Levels s={s} />
          <button
            onClick={onTrade}
            className={`h-10 rounded-lg text-sm font-bold text-background inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition ${isCall ? "bg-bull glow-bull" : "bg-bear glow-bear"}`}
          >
            <Zap className="h-4 w-4" /> Trade {s.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function FnoCard({ s, onTrade }: { s: FnoSignal; onTrade: () => void }) {
  const isCall = s.right === "C";
  return (
    <div className="rounded-2xl glass p-4 flex flex-col gap-3 border border-surface-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/stock/$symbol" params={{ symbol: s.underlying }} className={`text-lg font-bold hover:text-primary transition ${isCall ? "text-bull" : "text-bear"}`} title="Open chart">
            {s.label}
          </Link>
          {s.score != null && <span className="rounded-md bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.5">Score {Math.round(s.score)}</span>}
        </div>
        {s.iv ? <span className="text-[10px] text-muted-foreground num">IV {s.iv.toFixed(0)}%</span> : null}
      </div>
      <div className="-mt-1"><Meta s={s} /></div>
      <Levels s={s} />
      {s.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.reasons.slice(0, 3).map((r, i) => (
            <span key={i} className="text-[10px] rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground">{r}</span>
          ))}
        </div>
      )}
      <button
        onClick={onTrade}
        className={`mt-auto h-9 rounded-lg text-sm font-bold text-background inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition ${isCall ? "bg-bull glow-bull" : "bg-bear glow-bear"}`}
      >
        <Zap className="h-4 w-4" /> Trade {s.label}
      </button>
    </div>
  );
}

function FnoRealityCheck({ b, active, closed, marketFalling, indexAvg }: {
  b: TsBacktest; active: number; closed: TsAlert[]; marketFalling: boolean; indexAvg: number;
}) {
  const cells = [
    { k: "Win Rate", v: `${b.winRate?.toFixed(1)}%`, c: "text-info" },
    { k: "Profit Factor", v: b.profitFactor?.toFixed(2), c: b.profitFactor >= 1 ? "text-bull" : "text-bear" },
    { k: "Avg Win", v: `${b.avgWinR?.toFixed(2)}R`, c: "text-bull" },
    { k: "Avg Loss", v: `${b.avgLossR?.toFixed(2)}R`, c: "text-bear" },
    { k: "Max Drawdown", v: `-${b.maxDrawdownPct?.toFixed(1)}%`, c: "text-bear" },
    { k: "Max Consec Losses", v: String(b.maxConsecLosses), c: "text-warn" },
    { k: "Backtest Trades", v: String(b.trades), c: "text-muted-foreground" },
    { k: "Active F&O Signals", v: String(active), c: "text-info" },
  ];
  return (
    <section className="rounded-2xl glass p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold flex items-center gap-2"><Gauge className="h-4 w-4 text-warn" /> F&O Strategy Reality Check</div>
        {marketFalling && (
          <span className="text-[11px] text-bear inline-flex items-center gap-1"><TrendingDown className="h-3 w-3" /> market {indexAvg.toFixed(2)}%</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        These options express our backtested STOCK strategy ({b.symbols} symbols, {b.trades} trades, {b.riskPerTrade}% risk each).
        The stats below are that underlying edge — options add leverage AND lose value to time decay (theta), so treat them as a
        higher-risk expression of the same signals. Premium levels are delta-mapped estimates. Past performance ≠ future results.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {cells.map((c) => (
          <div key={c.k} className="rounded-lg hairline bg-surface-1 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.k}</div>
            <div className={`text-lg font-bold num mt-1 ${c.c}`}>{c.v}</div>
          </div>
        ))}
      </div>

      {closed.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Recently Closed Underlying Signals</div>
          <div className="space-y-1.5">
            {closed.slice(0, 6).map((c) => {
              const win = (c.resultPct ?? 0) >= 0;
              return (
                <div key={c.id} className="flex items-center justify-between rounded-lg hairline bg-surface-1 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">{c.status}</span>
                  </div>
                  <div className="flex items-center gap-3 num">
                    <span className="text-muted-foreground">{money(c.entry)} → {money(c.closePrice ?? 0)}</span>
                    <span className={`font-semibold ${win ? "text-bull" : "text-bear"}`}>{`${win ? "+" : ""}${(c.resultPct ?? 0).toFixed(2)}%`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
