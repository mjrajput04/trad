import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, ShieldCheck, X, Zap } from "lucide-react";
import { getAccountSummary, placeOrder, type OptionContract, type OptionQuote } from "@/lib/api/ibkr";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { toast } from "sonner";

/** Human date from an IBKR YYYYMMDD maturity string. */
export const fmtExpiry = (ymd: string) => {
  if (!ymd || ymd.length !== 8) return ymd;
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00`);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit" });
};

// Capital-risk presets: max loss per F&O trade as a % of account equity.
// Options can go to zero, so every BUY attaches a protective stop and the size
// is capped so a stop-out costs at most this fraction of the account.
const RISK_PRESETS = [0.1, 0.15, 0.2];
const DEFAULT_RISK = 0.2;
const DEFAULT_STOP_PCT = 25; // fallback protective stop when no signal stop given

/** One-tap option order popup with a mandatory capital-risk stop-loss on BUY. */
export function OptionTradeModal({ symbol, contract, quote, defaultStop, defaultTarget, onClose }: {
  symbol: string;
  contract: OptionContract;
  quote?: OptionQuote;
  /** Protective stop premium (e.g. an AI F&O signal's delta-mapped stop). */
  defaultStop?: number;
  /** Take-profit premium (optional). */
  defaultTarget?: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isPaper, currentAccount } = useTrading();
  const mid = quote && quote.bid > 0 && quote.ask > 0 ? (quote.bid + quote.ask) / 2 : quote?.last ?? 0;

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(0);
  const [type, setType] = useState<"MKT" | "LMT">("LMT");
  const [price, setPrice] = useState<number>(+mid.toFixed(2));
  const [riskPct, setRiskPct] = useState<number>(DEFAULT_RISK);
  const [stopPrice, setStopPrice] = useState<number>(() => {
    if (defaultStop && defaultStop > 0 && defaultStop < mid) return +defaultStop.toFixed(2);
    return mid > 0 ? +(mid * (1 - DEFAULT_STOP_PCT / 100)).toFixed(2) : 0;
  });
  const [tp, setTp] = useState<number>(defaultTarget && defaultTarget > mid ? +defaultTarget.toFixed(2) : 0);

  const { data: summary } = useQuery({ queryKey: ["ibkr-summary"], queryFn: getAccountSummary, staleTime: 30_000 });
  const netLiq = summary?.netLiquidation ?? 0;
  const avail = summary?.availableFunds || netLiq;

  const desc = `${symbol} ${fmtExpiry(contract.maturityDate)} $${contract.strike} ${contract.right === "C" ? "CALL" : "PUT"}`;

  // The premium we'd actually pay (limit price, or the ask for a market order).
  const entryRef = useMemo(
    () => (type === "LMT" ? (price || mid) : (quote?.ask || mid)),
    [type, price, mid, quote]
  );

  // Contracts that keep a stop-out within `rp`% of the account.
  const autoQty = (rp: number) => {
    if (entryRef > 0 && stopPrice > 0 && stopPrice < entryRef && netLiq > 0) {
      const perLot = (entryRef - stopPrice) * 100;
      const byRisk = Math.floor((netLiq * rp) / 100 / perLot);
      const affordable = Math.floor((avail * 0.95) / (entryRef * 100));
      return Math.max(1, Math.min(byRisk || 1, Math.max(1, affordable)));
    }
    return 1;
  };

  // Auto-size once, on the first render where the numbers are known.
  useEffect(() => {
    if (side === "BUY" && qty === 0 && entryRef > 0) setQty(autoQty(riskPct));
  }, [side, qty, entryRef, stopPrice, netLiq, riskPct, avail]); // eslint-disable-line react-hooks/exhaustive-deps

  const perLot = entryRef > 0 && stopPrice > 0 && stopPrice < entryRef ? (entryRef - stopPrice) * 100 : 0;
  const stopPctBelow = entryRef > 0 && stopPrice > 0 ? ((entryRef - stopPrice) / entryRef) * 100 : 0;
  const est = qty * 100 * entryRef;
  const maxLoss = perLot * qty;
  const maxLossPct = netLiq > 0 ? (maxLoss / netLiq) * 100 : 0;
  const budget = netLiq > 0 ? (netLiq * riskPct) / 100 : 0;
  const overBudget = netLiq > 0 && maxLoss > budget * 1.02;

  const order = useMutation({
    mutationFn: () => {
      if (!qty || qty <= 0) throw new Error("Enter contracts quantity");
      if (type === "LMT" && (!price || price <= 0)) throw new Error("Limit orders need a price");
      if (side === "BUY") {
        if (!stopPrice || stopPrice <= 0) throw new Error("A protective stop is required on F&O buys");
        if (stopPrice >= entryRef) throw new Error("Stop must be below the entry premium");
      }
      return placeOrder({
        symbol: desc,
        conid: contract.conid,
        side,
        quantity: qty,
        orderType: type,
        price: type === "LMT" ? price : undefined,
        stopLoss: side === "BUY" ? stopPrice : undefined,
        takeProfit: side === "BUY" && tp > 0 ? tp : undefined,
      });
    },
    onSuccess: (r) => {
      toast.success(`${side} ${qty}x ${desc} sent — #${r.orderId} (${r.status})`);
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-positions"] });
      qc.invalidateQueries({ queryKey: ["ibkr-summary"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Order failed"),
  });

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl glass hairline p-5 max-h-[92vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-info" />
            <h3 className="text-sm font-semibold">{desc}</h3>
          </div>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-md hover:bg-surface-2">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Bid ${fmtMoney(quote?.bid ?? 0)} · Ask ${fmtMoney(quote?.ask ?? 0)}
          {quote?.delta ? <> · Δ {quote.delta.toFixed(2)}</> : null}
          {quote?.iv ? <> · IV {quote.iv.toFixed(0)}%</> : null}
          · {isPaper ? "paper" : "live"} <span className="num">{currentAccount}</span>
        </p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setSide("BUY")} className={`h-9 rounded-lg text-sm font-bold transition ${side === "BUY" ? "bg-bull text-background glow-bull" : "hairline bg-surface-1 text-muted-foreground"}`}>BUY</button>
          <button onClick={() => setSide("SELL")} className={`h-9 rounded-lg text-sm font-bold transition ${side === "SELL" ? "bg-bear text-background glow-bear" : "hairline bg-surface-1 text-muted-foreground"}`}>SELL</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Contracts</div>
            <input type="number" min={1} value={qty || ""} onChange={(e) => setQty(Math.floor(+e.target.value))} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Order Type</div>
            <select value={type} onChange={(e) => setType(e.target.value as "MKT" | "LMT")} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
              <option value="LMT">Limit</option>
              <option value="MKT">Market</option>
            </select>
          </label>
        </div>
        {type === "LMT" && (
          <label className="block mb-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Limit Price (per share)</div>
            <input type="number" min={0} step="0.01" value={price || ""} onChange={(e) => setPrice(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
          </label>
        )}

        {side === "BUY" && (
          <div className="mb-3 rounded-xl border border-info/25 bg-info/5 p-3">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-info">
              <ShieldCheck className="h-3.5 w-3.5" /> Auto stop-loss — caps your loss
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Max loss per trade (of account)</div>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {RISK_PRESETS.map((rp) => (
                <button
                  key={rp}
                  onClick={() => { setRiskPct(rp); setQty(autoQty(rp)); }}
                  className={`h-8 rounded-lg text-xs font-semibold transition ${riskPct === rp ? "bg-primary/20 text-primary hairline" : "hairline bg-surface-1 text-muted-foreground"}`}
                >
                  {rp}%
                </button>
              ))}
            </div>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Stop price (premium){stopPctBelow > 0 && <span className="text-bear"> · {stopPctBelow.toFixed(0)}% below entry</span>}
              </div>
              <input type="number" min={0} step="0.01" value={stopPrice || ""} onChange={(e) => setStopPrice(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bear focus:outline-none" />
            </label>
            <label className="block mt-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Take profit (premium, optional)</div>
              <input type="number" min={0} step="0.01" value={tp || ""} onChange={(e) => setTp(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bull focus:outline-none" />
            </label>
          </div>
        )}

        <div className="rounded-xl hairline bg-surface-1 p-3 text-xs mb-3 space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Estimated {side === "BUY" ? "cost" : "credit"}</span><span className="num font-semibold">${fmtMoney(est, 0)}</span></div>
          {side === "BUY" && maxLoss > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max loss if stopped</span>
              <span className={`num font-semibold ${overBudget ? "text-bear" : "text-warn"}`}>${fmtMoney(maxLoss, 0)}{netLiq > 0 && <> · {maxLossPct.toFixed(2)}%</>}</span>
            </div>
          )}
          {tp > 0 && perLot > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Target gain</span><span className="num font-semibold text-bull">${fmtMoney((tp - entryRef) * 100 * qty, 0)}</span></div>
          )}
        </div>

        {side === "BUY" && overBudget && (
          <div className="mb-3 rounded-lg bg-bear/10 border border-bear/20 px-3 py-2 text-[11px] text-bear flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Max loss ${fmtMoney(maxLoss, 0)} is above your {riskPct}% cap (${fmtMoney(budget, 0)}). Reduce contracts or widen nothing — cut size.
          </div>
        )}
        {side === "SELL" && (
          <div className="mb-3 rounded-lg bg-warn/10 border border-warn/20 px-3 py-2 text-[11px] text-warn flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Selling to close is fine; selling options you don't own = naked short — losses can exceed the credit.
          </div>
        )}
        {!isPaper && (
          <div className="mb-3 rounded-lg bg-bear/10 border border-bear/20 px-3 py-2 text-[11px] text-bear flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Live account — real-money order. Options can expire worthless.
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-sm font-semibold">Cancel</button>
          <button
            onClick={() => order.mutate()}
            disabled={order.isPending}
            className={`flex-1 h-10 rounded-lg text-sm font-bold text-background ${side === "BUY" ? "bg-bull glow-bull" : "bg-bear glow-bear"} disabled:opacity-50 inline-flex items-center justify-center gap-2`}
          >
            {order.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm ${side}`}
          </button>
        </div>
        {side === "BUY" && (
          <p className="mt-2 text-[10px] text-muted-foreground text-center">
            A GTC stop-loss at ${fmtMoney(stopPrice)} is attached automatically when this fills.
          </p>
        )}
      </div>
    </div>
  );
}
