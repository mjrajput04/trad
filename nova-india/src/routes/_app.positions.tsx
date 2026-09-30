import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Delta } from "@/components/Delta";
import { fmtMoney } from "@/lib/market-data";
import { getPositions, closePosition, type Position } from "@/lib/api/ibkr";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/positions")({
  head: () => ({ meta: [{ title: "Positions · NOVA" }] }),
  component: Positions,
});

function Positions() {
  const qc = useQueryClient();

  const { data: positions = [], isLoading, isError, error } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 5_000,
  });

  const close = useMutation({
    mutationFn: (p: Position) => closePosition(p.conid, p.quantity),
    onSuccess: (result) => {
      toast.success(`Close order sent to IBKR — #${result.orderId} (${result.status})`);
      qc.invalidateQueries({ queryKey: ["ibkr-positions"] });
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Close failed"),
  });

  const confirmClose = (p: Position) => {
    const side = p.quantity > 0 ? "SELL" : "BUY";
    if (window.confirm(`Close ${p.symbol}: ${side} ${Math.abs(p.quantity)} @ market — send to IBKR?`)) {
      close.mutate(p);
    }
  };

  const total = positions.reduce((a, r) => a + (r.pnl ?? 0), 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Open Positions</h1>
          <p className="text-sm text-muted-foreground">Realtime mark-to-market P&L synced from IBKR.</p>
        </div>
        <div className="rounded-xl glass px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Unrealized</div>
          <div className={`text-lg font-semibold num ${total >= 0 ? "text-bull" : "text-bear"}`}>
            {total >= 0 ? "+" : ""}${fmtMoney(total)}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">Could not load positions from IBKR</div>
          <div className="text-muted-foreground text-xs">{(error as Error)?.message}</div>
        </div>
      ) : positions.length === 0 ? (
        <div className="rounded-2xl glass p-10 text-center text-muted-foreground text-sm">No open positions</div>
      ) : (
        <div className="rounded-2xl glass overflow-hidden">
          {/* horizontal scroll on narrow screens so columns never collide */}
          <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[720px]">
          <div className="grid grid-cols-12 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground hairline-b">
            <div className="col-span-2">Symbol</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-2 text-right">Entry</div>
            <div className="col-span-2 text-right">Mark</div>
            <div className="col-span-2 text-right">Unrealized P&L</div>
            <div className="col-span-1 text-right">%</div>
            <div className="col-span-1 text-right">Side</div>
            <div className="col-span-1 text-right">Action</div>
          </div>
          {positions.map((r) => {
            const up = (r.pnl ?? 0) >= 0;
            return (
              <div key={r.conid} className="grid grid-cols-12 items-center px-4 py-3 hairline-b last:border-0 hover:bg-surface-2 transition">
                <div className="col-span-2">
                  <div className="text-sm font-semibold">{r.symbol}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{r.assetClass}</div>
                </div>
                <div className="col-span-1 text-right num text-sm">{r.quantity}</div>
                <div className="col-span-2 text-right num text-sm text-muted-foreground">${fmtMoney(r.entryPrice)}</div>
                <div className="col-span-2 text-right num text-sm">${fmtMoney(r.currentPrice)}</div>
                <div className={`col-span-2 text-right num text-sm font-semibold ${up ? "text-bull" : "text-bear"}`}>
                  {up ? "+" : ""}${fmtMoney(r.pnl ?? 0)}
                </div>
                <div className="col-span-1 text-right"><Delta value={r.pnlPct} /></div>
                <div className="col-span-1 text-right">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${r.side === "LONG" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{r.side}</span>
                </div>
                <div className="col-span-1 flex justify-end">
                  <button onClick={() => confirmClose(r)} disabled={close.isPending}
                    title={`Close position (${r.quantity > 0 ? "SELL" : "BUY"} ${Math.abs(r.quantity)} @ MKT)`}
                    className="h-7 w-7 rounded-md hairline bg-surface-2 hover:bg-bear/20 grid place-items-center transition disabled:opacity-50">
                    <X className="h-3.5 w-3.5 text-bear" />
                  </button>
                </div>
              </div>
            );
          })}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
