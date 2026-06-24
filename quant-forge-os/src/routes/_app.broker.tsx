import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LiveDot } from "@/components/Delta";
import { Check, Plug, RefreshCw, Shield, Zap, Loader2, X } from "lucide-react";
import { useState, useEffect } from "react";
import { getAccountSummary, getAuthStatus, placeOrder, tickle } from "@/lib/api/ibkr";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/broker")({
  head: () => ({ meta: [{ title: "Broker · IBKR · NOVA" }] }),
  component: Broker,
});

function Broker() {
  const qc = useQueryClient();
  const { isPaper, setIsPaper, currentAccount } = useTrading();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState("LMT");
  const [symbol, setSymbol] = useState("AAPL");
  const [qty, setQty] = useState(100);
  const [price, setPrice] = useState(0);
  const [stop, setStop] = useState(0);
  const [tp, setTp] = useState(0);

  const { data: auth } = useQuery({
    queryKey: ["ibkr-auth"],
    queryFn: getAuthStatus,
    refetchInterval: 30_000,
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ["ibkr-summary"],
    queryFn: getAccountSummary,
    refetchInterval: 10_000,
  });

  const order = useMutation({
    mutationFn: () => placeOrder(symbol, side, qty, type, price || undefined, stop || undefined, tp || undefined),
    onSuccess: () => {
      toast.success(`${side} ${qty} ${symbol} order placed`);
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Order failed"),
  });

  const est = qty * price;
  const fees = (est * 0.00035).toFixed(2);
  const connected = auth?.authenticated && auth?.connected;

  return (
    <div className="p-6 grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <div className="rounded-2xl glass p-5 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-bull/15 blur-3xl" />
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg gradient-primary grid place-items-center glow-primary">
              <Plug className="h-5 w-5 text-background" />
            </div>
            <div>
              <div className="text-sm font-semibold">Interactive Brokers</div>
              <div className="text-[11px] text-muted-foreground">{currentAccount} · {isPaper ? "Paper" : "Live"} · Client Portal</div>
            </div>
            <div className={`ml-auto flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium ${connected ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
              <LiveDot /> {connected ? "Connected" : "Disconnected"}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Health label="API" status={connected ? "OK" : "ERR"} ok={!!connected} />
            <Health label="Gateway" status={auth?.connected ? "OK" : "ERR"} ok={!!auth?.connected} />
            <Health label="Auth" status={auth?.authenticated ? "OK" : "ERR"} ok={!!auth?.authenticated} />
            <Health label="Order Router" status={connected ? "OK" : "ERR"} ok={!!connected} />
          </div>

          <div className="mt-5 flex items-center justify-between rounded-xl hairline bg-surface-1 p-3">
            <div>
              <div className="text-sm font-medium">{isPaper ? "Paper Trading" : "Live Trading"}</div>
              <div className="text-[11px] text-muted-foreground">{isPaper ? "Risk-free simulation" : "Real money — orders execute on IBKR"}</div>
            </div>
            <button onClick={() => { setIsPaper(!isPaper); qc.invalidateQueries(); }} className={`relative h-6 w-11 rounded-full transition ${isPaper ? "bg-warn" : "bg-bull glow-bull"}`}>
              <span className="absolute top-0.5 h-5 w-5 rounded-full bg-background transition" style={{ left: isPaper ? 2 : 22 }} />
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <button onClick={() => { tickle(); qc.invalidateQueries(); toast.success("Reconnected"); }}
              className="flex-1 h-9 rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-xs font-medium inline-flex items-center justify-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Reconnect
            </button>
            <button onClick={() => qc.invalidateQueries()}
              className="flex-1 h-9 rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-xs font-medium inline-flex items-center justify-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Sync Account
            </button>
          </div>
        </div>

        <div className="rounded-2xl glass p-5">
          <div className="text-sm font-semibold mb-3">Account Snapshot</div>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                ["Net Liquidation", `$${fmtMoney(summary?.netLiquidation ?? 0)}`],
                ["Buying Power", `$${fmtMoney(summary?.buyingPower ?? 0)}`],
                ["Available Funds", `$${fmtMoney(summary?.availableFunds ?? 0)}`],
                ["Initial Margin", `$${fmtMoney(summary?.initMarginReq ?? 0)}`],
                ["Maintenance Margin", `$${fmtMoney(summary?.maintMarginReq ?? 0)}`],
                ["Excess Liquidity", `$${fmtMoney(summary?.excessLiquidity ?? 0)}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg hairline bg-surface-1 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="text-sm font-semibold num mt-1">{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl glass p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-info" /> Order Ticket</div>
            <div className="text-[11px] text-muted-foreground">{isPaper ? "Paper" : "Live"} · Smart Routing</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setSide("BUY")} className={`h-10 rounded-lg text-sm font-bold transition ${side === "BUY" ? "bg-bull text-background glow-bull" : "hairline bg-surface-1 text-muted-foreground"}`}>BUY</button>
          <button onClick={() => setSide("SELL")} className={`h-10 rounded-lg text-sm font-bold transition ${side === "SELL" ? "bg-bear text-background glow-bear" : "hairline bg-surface-1 text-muted-foreground"}`}>SELL</button>
        </div>

        <div className="space-y-3">
          <Row label="Symbol">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm font-semibold focus:outline-none" />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Quantity">
              <input type="number" value={qty} onChange={(e) => setQty(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
            </Row>
            <Row label="Order Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
                <option>MKT</option><option>LMT</option><option>STP</option><option>STP LMT</option><option>BRACKET</option>
              </select>
            </Row>
          </div>
          <Row label="Limit Price">
            <input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Stop Loss">
              <input type="number" value={stop} onChange={(e) => setStop(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bear focus:outline-none" />
            </Row>
            <Row label="Take Profit">
              <input type="number" value={tp} onChange={(e) => setTp(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bull focus:outline-none" />
            </Row>
          </div>
        </div>

        <div className="mt-5 rounded-xl hairline bg-surface-1 p-4 space-y-2 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Estimated cost</span><span className="num font-semibold">${est.toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Commission est.</span><span className="num">${fees}</span></div>
          {stop > 0 && tp > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Reward / Risk</span><span className="num text-bull">{((tp - price) / (price - stop)).toFixed(2)}R</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground">Buying power used</span><span className="num">{summary?.buyingPower ? ((est / summary.buyingPower) * 100).toFixed(1) : "0"}%</span></div>
        </div>

        <button
          onClick={() => order.mutate()}
          disabled={order.isPending || !connected}
          className={`mt-4 w-full h-11 rounded-lg text-sm font-bold tracking-wide ${side === "BUY" ? "bg-bull glow-bull" : "bg-bear glow-bear"} text-background disabled:opacity-50 inline-flex items-center justify-center gap-2`}
        >
          {order.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{side} {qty} {symbol}{price > 0 ? ` @ $${price}` : " MKT"}</>}
        </button>
      </div>
    </div>
  );
}

function Health({ label, status, ok }: { label: string; status: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg hairline bg-surface-1 p-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ok ? "text-bull" : "text-bear"}`}>
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {status}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
