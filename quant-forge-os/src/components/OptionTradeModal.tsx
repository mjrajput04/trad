import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, X, Zap } from "lucide-react";
import { placeOrder, type OptionContract, type OptionQuote } from "@/lib/api/ibkr";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { toast } from "sonner";

/** Human date from an IBKR YYYYMMDD maturity string. */
export const fmtExpiry = (ymd: string) => {
  if (!ymd || ymd.length !== 8) return ymd;
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00`);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit" });
};

/** One-tap option order popup (contracts, MKT/LMT, live bid/ask/greeks). */
export function OptionTradeModal({ symbol, contract, quote, onClose }: {
  symbol: string;
  contract: OptionContract;
  quote?: OptionQuote;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isPaper, currentAccount } = useTrading();
  const mid = quote && quote.bid > 0 && quote.ask > 0 ? (quote.bid + quote.ask) / 2 : quote?.last ?? 0;
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(1);
  const [type, setType] = useState<"MKT" | "LMT">("LMT");
  const [price, setPrice] = useState<number>(+mid.toFixed(2));

  const desc = `${symbol} ${fmtExpiry(contract.maturityDate)} $${contract.strike} ${contract.right === "C" ? "CALL" : "PUT"}`;
  const est = qty * 100 * (type === "LMT" ? price : (quote?.ask ?? mid));

  const order = useMutation({
    mutationFn: () => {
      if (!qty || qty <= 0) throw new Error("Enter contracts quantity");
      if (type === "LMT" && (!price || price <= 0)) throw new Error("Limit orders need a price");
      return placeOrder({
        symbol: desc,
        conid: contract.conid,
        side,
        quantity: qty,
        orderType: type,
        price: type === "LMT" ? price : undefined,
      });
    },
    onSuccess: (r) => {
      toast.success(`${side} ${qty}x ${desc} sent — #${r.orderId} (${r.status})`);
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-positions"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Order failed"),
  });

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl glass hairline p-5" onClick={(e) => e.stopPropagation()}>
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

        <div className="rounded-xl hairline bg-surface-1 p-3 text-xs mb-3 space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Estimated {side === "BUY" ? "cost" : "credit"}</span><span className="num font-semibold">${fmtMoney(est, 0)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Per contract</span><span className="num">${fmtMoney(est / Math.max(qty, 1), 0)} (×100 shares)</span></div>
        </div>

        {side === "SELL" && (
          <div className="mb-3 rounded-lg bg-warn/10 border border-warn/20 px-3 py-2 text-[11px] text-warn flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Selling options you don't own = naked short — losses can exceed the credit. Only do this if you know exactly what it means.
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
      </div>
    </div>
  );
}
