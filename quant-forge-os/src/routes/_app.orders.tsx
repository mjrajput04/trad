import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fmtMoney } from "@/lib/market-data";
import { getOrders, cancelOrder } from "@/lib/api/ibkr";
import { Check, Clock, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/orders")({
  head: () => ({ meta: [{ title: "Orders · NOVA" }] }),
  component: Orders,
});

const TABS = ["Working", "Filled", "Canceled", "Rejected"] as const;

// What an order actually IS in plain terms: a SELL stop protects a long (stop
// loss), a SELL limit books profit (take profit), TRAIL = trailing stop, etc.
function orderRole(o: { type?: string; side?: string }): { label: string; cls: string } | null {
  const t = (o.type ?? "").toUpperCase();
  if (t.includes("TRAIL")) return { label: "TRAILING SL", cls: "text-bear" };
  if (t.includes("STOP") || t === "STP") return { label: "STOP LOSS", cls: "text-bear" };
  if ((t.includes("LIMIT") || t === "LMT") && o.side === "SELL") return { label: "TAKE PROFIT", cls: "text-bull" };
  return null;
}

function Orders() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Working");
  const qc = useQueryClient();

  const { data: allOrders = [], isLoading } = useQuery({
    queryKey: ["ibkr-orders"],
    queryFn: getOrders,
    refetchInterval: 3_000,
  });

  const cancel = useMutation({
    mutationFn: (orderId: string) => cancelOrder(orderId),
    onSuccess: () => { toast.success("Order cancelled"); qc.invalidateQueries({ queryKey: ["ibkr-orders"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Cancel failed"),
  });

  const orders = allOrders.filter((o) => o.status === tab);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">Live order book synced with IBKR Gateway.</p>
        </div>
        <div className="text-xs text-muted-foreground">{allOrders.length} total orders</div>
      </div>

      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 h-8 rounded-lg text-xs hairline ${tab === t ? "bg-primary/15 text-foreground" : "bg-surface-1 text-muted-foreground hover:bg-surface-2"}`}>
            {t} {allOrders.filter((o) => o.status === t).length > 0 && <span className="ml-1 opacity-60">({allOrders.filter((o) => o.status === t).length})</span>}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl glass p-10 text-center text-muted-foreground text-sm">No {tab.toLowerCase()} orders</div>
      ) : (
        <div className="rounded-2xl glass overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground hairline-b">
            <div className="col-span-1">Time</div>
            <div className="col-span-2">Symbol</div>
            <div className="col-span-1">Side</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">Total</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1 text-right">Action</div>
          </div>
          {orders.map((o) => (
            <div key={o.orderId} className="grid grid-cols-12 items-center px-4 py-3 hairline-b last:border-0 hover:bg-surface-2 transition">
              <div className="col-span-1 text-xs text-muted-foreground num">{o.time}</div>
              <div className="col-span-2 text-sm font-semibold">{o.symbol}</div>
              <div className="col-span-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${o.side === "BUY" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{o.side}</span>
              </div>
              <div className="col-span-1">
                <div className="text-xs text-muted-foreground">{o.type}</div>
                {(() => { const r = orderRole(o); return r ? <div className={`text-[9px] font-bold tracking-wide ${r.cls}`}>{r.label}</div> : null; })()}
              </div>
              <div className="col-span-1 text-right num text-sm">{o.quantity}</div>
              <div className="col-span-2 text-right num text-sm">{o.price > 0 ? `$${fmtMoney(o.price)}` : "MKT"}</div>
              <div className="col-span-2 text-right num text-sm text-muted-foreground">{o.price > 0 ? `$${fmtMoney(o.price * o.quantity)}` : "—"}</div>
              <div className="col-span-1">
                <span className="inline-flex items-center gap-1 text-[11px]">
                  {tab === "Working" && <><Clock className="h-3 w-3 text-warn" /><span className="text-warn">Working</span></>}
                  {tab === "Filled" && <><Check className="h-3 w-3 text-bull" /><span className="text-bull">Filled</span></>}
                  {tab === "Canceled" && <><X className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Canceled</span></>}
                  {tab === "Rejected" && <><X className="h-3 w-3 text-bear" /><span className="text-bear">Rejected</span></>}
                </span>
              </div>
              <div className="col-span-1 flex justify-end">
                {tab === "Working" && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Cancel ${o.side} ${o.quantity} ${o.symbol} (order #${o.orderId})?`)) {
                        cancel.mutate(String(o.orderId));
                      }
                    }}
                    disabled={cancel.isPending}
                    className="text-[11px] text-bear hover:underline disabled:opacity-50">Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
