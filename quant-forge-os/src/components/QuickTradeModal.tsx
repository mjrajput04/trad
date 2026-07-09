import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, X, Zap } from "lucide-react";
import { cancelWorkingOrders, getAccountSummary, getQuotes, placeOrder } from "@/lib/api/ibkr";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { toast } from "sonner";

export interface QuickTradeDefaults {
  /** Suggested entry/limit price (e.g. the alert's entry). */
  price?: number;
  /** Fixed stop level (used to derive the trailing % and position size). */
  stop?: number;
  /** Take-profit level. */
  takeProfit?: number;
}

interface Props {
  symbol: string;
  side: "BUY" | "SELL";
  /** Shares currently held — pre-fills the SELL quantity. */
  ownedQty?: number;
  defaults?: QuickTradeDefaults;
  onClose: () => void;
}

/**
 * One-tap trade popup used by the Alerts page. Pre-fills sensible values
 * (alert levels, 1%-risk position size, owned quantity for sells, trailing
 * stop) but everything stays editable before the order is sent to IBKR.
 */
export function QuickTradeModal({ symbol, side: initialSide, ownedQty = 0, defaults, onClose }: Props) {
  const qc = useQueryClient();
  const { isPaper, currentAccount } = useTrading();

  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [qty, setQty] = useState<number>(0);
  const [type, setType] = useState<"MKT" | "LMT">("MKT");
  const [price, setPrice] = useState<number>(defaults?.price ?? 0);
  const [slMode, setSlMode] = useState<"trail" | "fixed" | "none">(defaults?.stop ? "trail" : "none");
  const [trailPct, setTrailPct] = useState<number>(0);
  const [fixedStop, setFixedStop] = useState<number>(defaults?.stop ?? 0);
  const [tp, setTp] = useState<number>(defaults?.takeProfit ?? 0);

  const { data: quotes } = useQuery({
    queryKey: ["order-quote", symbol],
    queryFn: () => getQuotes([symbol]),
    refetchInterval: 3_000,
  });
  const now = quotes?.[0]?.last ?? 0;

  const { data: summary } = useQuery({
    queryKey: ["ibkr-summary"],
    queryFn: getAccountSummary,
    staleTime: 30_000,
  });

  // Seed qty + trailing % once prices are known:
  //  - SELL: everything you own (editable).
  //  - BUY: size the position so a stop-out loses ~1% of the account —
  //    the single most effective "small losses" rule there is.
  //  - trail % = distance from entry to the alert's stop (min 0.5%).
  useEffect(() => {
    const ref = defaults?.price || now;
    if (qty === 0) {
      if (side === "SELL" && ownedQty > 0) setQty(ownedQty);
      else if (side === "BUY" && ref > 0) {
        const stopRef = defaults?.stop ?? 0;
        const perShareRisk = stopRef > 0 ? ref - stopRef : ref * 0.02;
        const netLiq = summary?.netLiquidation ?? 0;
        if (netLiq > 0 && perShareRisk > 0) {
          const suggested = Math.floor((netLiq * 0.01) / perShareRisk);
          const affordable = Math.floor((netLiq * 0.95) / ref);
          setQty(Math.max(1, Math.min(suggested, affordable)));
        } else {
          setQty(1);
        }
      }
    }
    if (trailPct === 0 && ref > 0 && defaults?.stop && defaults.stop < ref) {
      setTrailPct(Number((((ref - defaults.stop) / ref) * 100).toFixed(2)));
    }
    if (price === 0 && ref > 0) setPrice(Number(ref.toFixed(2)));
  }, [now, summary, side, ownedQty, defaults, qty, trailPct, price]);

  const order = useMutation({
    mutationFn: async () => {
      if (!qty || qty <= 0) throw new Error("Enter a valid quantity");
      if (type === "LMT" && (!price || price <= 0)) throw new Error("Limit orders need a price");
      if (slMode === "trail" && (!trailPct || trailPct <= 0)) throw new Error("Enter a trailing %");
      if (slMode === "fixed" && (!fixedStop || fixedStop <= 0)) throw new Error("Enter a stop price");
      // Selling out of a position? First cancel its leftover bracket orders
      // (GTC stop/target) — otherwise they fire later and flip you short.
      if (side === "SELL" && ownedQty > 0) {
        await cancelWorkingOrders({ symbol }).catch(() => {});
      }
      return placeOrder({
        symbol,
        side,
        quantity: qty,
        orderType: type,
        price: type === "LMT" ? price : undefined,
        trailingStopPct: side === "BUY" && slMode === "trail" ? trailPct : undefined,
        stopLoss: side === "BUY" && slMode === "fixed" ? fixedStop : undefined,
        takeProfit: side === "BUY" && tp > 0 ? tp : undefined,
      });
    },
    onSuccess: (result) => {
      toast.success(`${side} ${qty} ${symbol} sent to IBKR — #${result.orderId} (${result.status})`);
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-positions"] });
      qc.invalidateQueries({ queryKey: ["ibkr-summary"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Order failed"),
  });

  const est = qty * (type === "LMT" ? price : now);
  const riskPct =
    side === "BUY" && summary?.netLiquidation && qty > 0
      ? slMode === "trail" && trailPct > 0
        ? ((qty * (type === "LMT" ? price : now) * (trailPct / 100)) / summary.netLiquidation) * 100
        : slMode === "fixed" && fixedStop > 0
          ? ((qty * ((type === "LMT" ? price : now) - fixedStop)) / summary.netLiquidation) * 100
          : null
      : null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl glass hairline p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-info" />
            <h3 className="text-base font-semibold">{symbol}</h3>
            {now > 0 && <span className="text-sm num text-muted-foreground">${fmtMoney(now)}</span>}
          </div>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-md hover:bg-surface-2">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          IBKR {isPaper ? "paper" : "live"} account <span className="num">{currentAccount}</span>
          {ownedQty > 0 && <> · you hold <span className="num font-semibold">{ownedQty}</span> shares</>}
        </p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => { setSide("BUY"); }} className={`h-9 rounded-lg text-sm font-bold transition ${side === "BUY" ? "bg-bull text-background glow-bull" : "hairline bg-surface-1 text-muted-foreground"}`}>BUY</button>
          <button onClick={() => { setSide("SELL"); if (ownedQty > 0) setQty(ownedQty); }} className={`h-9 rounded-lg text-sm font-bold transition ${side === "SELL" ? "bg-bear text-background glow-bear" : "hairline bg-surface-1 text-muted-foreground"}`}>SELL</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Quantity</div>
            <input type="number" min={1} value={qty || ""} onChange={(e) => setQty(Math.floor(+e.target.value))} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Order Type</div>
            <select value={type} onChange={(e) => setType(e.target.value as "MKT" | "LMT")} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
              <option value="MKT">Market</option>
              <option value="LMT">Limit</option>
            </select>
          </label>
        </div>

        {type === "LMT" && (
          <label className="block mb-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Limit Price</div>
            <input type="number" min={0} step="0.01" value={price || ""} onChange={(e) => setPrice(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
          </label>
        )}

        {side === "BUY" && (
          <>
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Stop Loss</div>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {([
                  ["trail", "Trailing"],
                  ["fixed", "Fixed"],
                  ["none", "None"],
                ] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setSlMode(m)} className={`h-8 rounded-lg text-xs font-semibold transition ${slMode === m ? "bg-primary/20 text-primary hairline" : "hairline bg-surface-1 text-muted-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {slMode === "trail" && (
                <div className="flex items-center gap-2">
                  <input type="number" min={0.1} step="0.1" value={trailPct || ""} onChange={(e) => setTrailPct(+e.target.value)} className="w-24 h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bear focus:outline-none" />
                  <span className="text-xs text-muted-foreground">% trail — the stop follows the price up and locks in profit</span>
                </div>
              )}
              {slMode === "fixed" && (
                <input type="number" min={0} step="0.01" value={fixedStop || ""} onChange={(e) => setFixedStop(+e.target.value)} placeholder="Stop price" className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bear focus:outline-none" />
              )}
            </div>
            <label className="block mb-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Take Profit (optional)</div>
              <input type="number" min={0} step="0.01" value={tp || ""} onChange={(e) => setTp(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bull focus:outline-none" />
            </label>
          </>
        )}

        <div className="rounded-xl hairline bg-surface-1 p-3 space-y-1.5 text-xs mb-3">
          {est > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Estimated {side === "BUY" ? "cost" : "proceeds"}</span><span className="num font-semibold">${fmtMoney(est, 0)}</span></div>}
          {riskPct != null && Number.isFinite(riskPct) && riskPct > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Risk if stopped out</span>
              <span className={`num font-semibold ${riskPct > 2 ? "text-bear" : "text-muted-foreground"}`}>~{riskPct.toFixed(1)}% of account</span>
            </div>
          )}
        </div>

        {side === "SELL" && ownedQty === 0 && (
          <div className="mb-3 rounded-lg bg-warn/10 border border-warn/20 px-3 py-2 text-[11px] text-warn flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> You don't hold {symbol} — selling would open a SHORT position.
          </div>
        )}
        {side === "SELL" && ownedQty > 0 && qty > ownedQty && (
          <div className="mb-3 rounded-lg bg-warn/10 border border-warn/20 px-3 py-2 text-[11px] text-warn flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Selling more than the {ownedQty} you hold shorts the difference.
          </div>
        )}
        {!isPaper && (
          <div className="mb-3 rounded-lg bg-bear/10 border border-bear/20 px-3 py-2 text-[11px] text-bear flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Live account — this places a real-money order.
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-sm font-semibold">Cancel</button>
          <button
            onClick={() => order.mutate()}
            disabled={order.isPending}
            className={`flex-1 h-10 rounded-lg text-sm font-bold text-background ${side === "BUY" ? "bg-bull glow-bull" : "bg-bear glow-bear"} disabled:opacity-50 inline-flex items-center justify-center gap-2`}
          >
            {order.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `${side} ${qty || ""} ${symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}
