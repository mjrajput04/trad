import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { getQuotes, getPositions } from "@/lib/api/ibkr";
import { QuickTradeModal } from "@/components/QuickTradeModal";
import { TradingViewChart } from "@/components/TradingViewChart";
import { fmtCompact, fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/stock/$symbol")({
  component: StockDetail,
});

function StockDetail() {
  const { symbol } = Route.useParams();
  const sym = (symbol ?? "").toUpperCase();
  const navigate = useNavigate();
  const [trade, setTrade] = useState<{ side: "BUY" | "SELL" } | null>(null);

  // Live IBKR quote (2s tick) — drives the header + market data panel.
  const { data: quotes, isLoading, isError } = useQuery({
    queryKey: ["order-quote", sym],
    queryFn: () => getQuotes([sym]),
    refetchInterval: 2_000,
    enabled: sym.length > 0,
  });
  const q = quotes?.[0];
  const up = (q?.changePct ?? 0) >= 0;

  // Holdings → Sell button with owned quantity.
  const { data: positions = [] } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 15_000,
    retry: false,
  });
  const owned = positions.find((p) => p.symbol?.toUpperCase() === sym)?.quantity ?? 0;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => window.history.length > 1 ? window.history.back() : navigate({ to: "/alerts" })}
          className="h-9 w-9 grid place-items-center rounded-lg hairline bg-surface-1 hover:bg-surface-2 transition">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{sym}</h1>
            {owned > 0 && (
              <span className="rounded bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.5">
                Holding {owned}
              </span>
            )}
          </div>
          {q && q.last > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold num">${fmtMoney(q.last)}</span>
              <span className={`inline-flex items-center gap-1 text-sm num ${up ? "text-bull" : "text-bear"}`}>
                {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {up ? "+" : ""}{(q.changePct ?? 0).toFixed(2)}%
              </span>
            </div>
          ) : isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading quote…
            </div>
          ) : isError ? (
            <div className="text-xs text-warn">IBKR quote unavailable — log in to the gateway (Broker page)</div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        {/* TradingView chart — full pro chart, free embed */}
        <div className="xl:col-span-3 rounded-2xl glass overflow-hidden" style={{ height: 620 }}>
          <TradingViewChart symbol={sym} />
        </div>

        <div className="space-y-4">
          {/* Market data (live from IBKR) */}
          <div className="rounded-2xl glass p-4">
            <div className="text-sm font-semibold mb-2">Market Data <span className="text-[10px] text-muted-foreground font-normal">· live from IBKR</span></div>
            <div className="space-y-1.5 text-xs">
              {([
                ["Open", q?.open ? `$${fmtMoney(q.open)}` : "—", ""],
                ["High", q?.high ? `$${fmtMoney(q.high)}` : "—", "text-bull"],
                ["Low", q?.low ? `$${fmtMoney(q.low)}` : "—", "text-bear"],
                ["Prev Close", q?.prevClose ? `$${fmtMoney(q.prevClose)}` : "—", ""],
                ["Bid", q?.bid ? `$${fmtMoney(q.bid)}` : "—", ""],
                ["Ask", q?.ask ? `$${fmtMoney(q.ask)}` : "—", ""],
                ["Volume", q?.volume ? fmtCompact(q.volume) : "—", ""],
              ] as const).map(([k, v, cls]) => (
                <div key={k} className="flex items-center justify-between py-1 hairline-b last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className={`num font-semibold ${cls}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Trade — opens the full popup (qty, MKT/LMT, trailing SL, TP) */}
          <div className="rounded-2xl glass p-4">
            <div className="text-sm font-semibold mb-1">Trade {sym}</div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Popup ma quantity, Market/Limit, trailing stop-loss ane take-profit set kari shakaay.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setTrade({ side: "BUY" })}
                className="flex-1 h-11 rounded-lg bg-bull glow-bull text-background text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition"
              >
                <ArrowUpRight className="h-4 w-4" /> Buy
              </button>
              {owned > 0 && (
                <button
                  onClick={() => setTrade({ side: "SELL" })}
                  className="flex-1 h-11 rounded-lg bg-bear glow-bear text-background text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition"
                >
                  <ArrowDownRight className="h-4 w-4" /> Sell {owned}
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              ⚠ Orders are sent live to your IBKR account. Trading involves risk.
            </p>
          </div>
        </div>
      </div>

      {trade && (
        <QuickTradeModal
          symbol={sym}
          side={trade.side}
          ownedQty={owned}
          defaults={q?.last ? { price: q.last } : undefined}
          onClose={() => setTrade(null)}
        />
      )}
    </div>
  );
}
