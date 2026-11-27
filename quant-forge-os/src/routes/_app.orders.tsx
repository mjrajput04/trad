import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fmtMoney } from "@/lib/market-data";
import { getOrders, cancelOrder } from "@/lib/api/broker";
import { Check, Clock, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { brokerInfo } from "@/lib/broker";
import { activeBroker } from "@/lib/broker";

export const Route = createFileRoute("/_app/orders")({
  head: () => ({ meta: [{ title: "Orders · NOVA" }] }),
  component: Orders,
});

const TABS = ["Working", "Filled", "Canceled", "Rejected"] as const;

// What an order actually IS in plain terms: a SELL stop protects a long (stop
// loss), a SELL limit books profit (take profit), TRAIL = trailing stop, etc.
// What the order is FOR, which is not the same as which way it points.
//
// This used to call any sell limit a take-profit. A SELL_SHORT limit is an
// entry — the opening of a bearish position — and 32 of this account's orders
// were painted bull-green "TAKE PROFIT" for the crime of being sales. Only a
// sale that closes a long, or a cover that closes a short, can be taking a
// profit, and E*TRADE says which is which in the action.
function orderRole(o: { type?: string; side?: string; action?: string }): { label: string; cls: string } | null {
  const t = (o.type ?? "").toUpperCase();
  const a = (o.action ?? "").toUpperCase();
  if (t.includes("TRAIL")) return { label: "TRAILING SL", cls: "text-bear" };
  if (t.includes("STOP") || t === "STP") return { label: "STOP LOSS", cls: "text-bear" };
  if (a === "SELL_SHORT" || a === "SELL_OPEN") return { label: "SHORT ENTRY", cls: "text-bear" };
  if (a === "BUY_TO_COVER" || a === "BUY_CLOSE") return { label: "COVER", cls: "text-bull" };
  const closingLong = a === "SELL" || a === "SELL_CLOSE" || (!a && o.side === "SELL");
  if ((t.includes("LIMIT") || t === "LMT") && closingLong) return { label: "TAKE PROFIT", cls: "text-bull" };
  return null;
}

function Orders() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Working");
  const qc = useQueryClient();

  const { data: allOrders = [], isLoading } = useQuery({
    queryKey: [activeBroker(), "ibkr-orders"],
    queryFn: getOrders,
    refetchInterval: 3_000,
  });

  const cancel = useMutation({
    mutationFn: (orderId: string) => cancelOrder(orderId),
    onSuccess: () => { toast.success("Order cancelled"); qc.invalidateQueries({ queryKey: [activeBroker(), "ibkr-orders"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Cancel failed"),
  });

  const orders = allOrders.filter((o) => o.status === tab);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">Live order book synced with {brokerInfo().short} Gateway.</p>
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
          {/* horizontal scroll on narrow screens so columns never collide */}
          <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[760px]">
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
                <div className="text-xs text-muted-foreground">
                  {o.type}
                  {/* 106 of this account's 125 orders were extended-hours and
                      nothing said so — which matters, because the session is
                      exactly what gets an order refused out of hours. */}
                  {o.session === "EXTENDED" && (
                    <span className="ml-1 text-[9px] text-warn">EXT</span>
                  )}
                  {o.tif === "GOOD_UNTIL_CANCEL" && (
                    <span className="ml-1 text-[9px] text-muted-foreground">GTC</span>
                  )}
                </div>
                {(() => { const r = orderRole(o); return r ? <div className={`text-[9px] font-bold tracking-wide ${r.cls}`}>{r.label}</div> : null; })()}
              </div>
              {/* Ordered is not traded. This column showed o.quantity for every row,
                  so a cancelled order for 100 shares read exactly like a hundred shares
                  that changed hands. Show what filled against what was asked whenever
                  the two differ, and grey the figure out when nothing filled at all. */}
              <div className="col-span-1 text-right num text-sm">
                {o.filled > 0 && o.filled < o.quantity ? (
                  <span className="text-warn">{o.filled} / {o.quantity}</span>
                ) : o.filled > 0 ? (
                  o.filled
                ) : (
                  <span className="text-muted-foreground">{o.quantity}</span>
                )}
              </div>
              {/* Price: once an order has filled, the only honest number is what it
                  filled AT. This showed o.price, which prefers the limit, so eleven
                  filled orders displayed the price asked rather than the price got.

                  Total: limit x ordered. Across this account that invented $2.2m of
                  turnover out of 58 orders that filled nothing whatsoever — a page of
                  cancelled intentions reading as a page of trades. Money only moved
                  where shares did, so that is the only place a total belongs. */}
              {(() => {
                const done = o.filled > 0;
                const shown = done && o.avgPrice > 0 ? o.avgPrice : o.price;
                const value = done ? (o.avgPrice > 0 ? o.avgPrice : o.price) * o.filled : 0;
                return (
                  <>
                    <div className="col-span-2 text-right num text-sm">
                      {shown > 0 ? `${fmtMoney(shown)}` : "MKT"}
                      {!done && shown > 0 && (
                        <span className="block text-[9px] text-muted-foreground leading-none">asking</span>
                      )}
                    </div>
                    <div className="col-span-2 text-right num text-sm text-muted-foreground">
                      {value > 0 ? `${fmtMoney(value)}` : "—"}
                    </div>
                  </>
                );
              })()}
              <div className="col-span-1">
                <span className="inline-flex items-center gap-1 text-[11px]">
                  {tab === "Working" && <><Clock className="h-3 w-3 text-warn" /><span className="text-warn">Working</span></>}
                  {tab === "Filled" && <><Check className="h-3 w-3 text-bull" /><span className="text-bull">Filled</span></>}
                  {tab === "Canceled" && <><X className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Canceled</span></>}
                  {tab === "Rejected" && <><X className="h-3 w-3 text-bear" /><span className="text-bear">Rejected</span></>}
                  {/* The cell above is switched on the TAB, and the list is
                      filtered to that same tab, so it could never say anything
                      the tab did not. An order that EXPIRED holding 300 traded
                      shares read simply "Canceled". Where the broker's own word
                      differs from the bucket it was sorted into, show it. */}
                  {o.rawStatus && o.rawStatus.toUpperCase() !== tab.toUpperCase() &&
                    !(tab === "Filled" && o.rawStatus.toUpperCase() === "EXECUTED") &&
                    !(tab === "Canceled" && o.rawStatus.toUpperCase().startsWith("CANCEL")) && (
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                        {o.rawStatus}
                      </span>
                    )}
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
          </div>
        </div>
      )}
    </div>
  );
}
