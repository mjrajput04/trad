import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LiveDot } from "@/components/Delta";
import { Check, ExternalLink, Plug, RefreshCw, Shield, Zap, Loader2, X } from "lucide-react";
import { useState } from "react";
import { getAccountSummary, getAuthStatus, placeOrder, tickle, ensureSession, GATEWAY_LOGIN_URL } from "@/lib/api/ibkr";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { SymbolPicker } from "@/components/SymbolPicker";
import { toast } from "sonner";

type BrokerSearch = {
  symbol?: string;
  side?: "BUY" | "SELL";
  type?: "MKT" | "LMT" | "STP";
  price?: number;
  stop?: number;
  tp?: number;
  qty?: number;
};

export const Route = createFileRoute("/_app/broker")({
  head: () => ({ meta: [{ title: "Broker · IBKR · NOVA" }] }),
  // Lets other pages (e.g. an alert's "Trade this") pre-fill the ticket.
  validateSearch: (s: Record<string, unknown>): BrokerSearch => {
    const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
    return {
      symbol: typeof s.symbol === "string" ? s.symbol : undefined,
      side: s.side === "SELL" ? "SELL" : s.side === "BUY" ? "BUY" : undefined,
      type: s.type === "MKT" || s.type === "LMT" || s.type === "STP" ? s.type : undefined,
      price: num(s.price),
      stop: num(s.stop),
      tp: num(s.tp),
      qty: num(s.qty),
    };
  },
  component: Broker,
});

function Broker() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const { isPaper, setIsPaper, paperConfigured, currentAccount } = useTrading();
  // Seed from search params when arriving via an alert's "Trade this" link.
  const [side, setSide] = useState<"BUY" | "SELL">(search.side ?? "BUY");
  const [type, setType] = useState<string>(search.type ?? "LMT");
  const [symbol, setSymbol] = useState((search.symbol ?? "AAPL").toUpperCase());
  const [qty, setQty] = useState(search.qty && search.qty > 0 ? search.qty : 100);
  const [price, setPrice] = useState(search.price ?? 0);
  const [stop, setStop] = useState(search.stop ?? 0);
  const [tp, setTp] = useState(search.tp ?? 0);
  const [fromAlert, setFromAlert] = useState(!!search.symbol && (search.price ?? 0) > 0);

  // Changing the symbol drops any prefilled price/stop/target — those levels
  // belonged to the previous (alert) symbol and are meaningless for a different
  // stock (e.g. an NVDA stop of $194 on a $73 UBER order, which IBKR would reject).
  const changeSymbol = (s: string) => {
    setSymbol(s);
    setPrice(0);
    setStop(0);
    setTp(0);
    setFromAlert(false);
  };

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
    mutationFn: () => {
      if (!symbol.trim()) throw new Error("Enter a symbol");
      if (!qty || qty <= 0 || !Number.isFinite(qty)) throw new Error("Enter a valid quantity");
      if (type !== "MKT" && (!price || price <= 0)) throw new Error(`${type} orders need a price`);
      // Bracket sanity: a long's stop sits below its target (and, for a priced
      // order, below the entry with the target above); a short is the mirror.
      if (stop > 0 && tp > 0) {
        if (side === "BUY" && stop >= tp) throw new Error("BUY bracket: stop-loss must be below take-profit");
        if (side === "SELL" && stop <= tp) throw new Error("SELL bracket: stop-loss must be above take-profit");
      }
      if (type !== "MKT" && price > 0) {
        if (side === "BUY" && stop > 0 && stop >= price) throw new Error("BUY: stop-loss must be below the limit price");
        if (side === "BUY" && tp > 0 && tp <= price) throw new Error("BUY: take-profit must be above the limit price");
        if (side === "SELL" && stop > 0 && stop <= price) throw new Error("SELL: stop-loss must be above the limit price");
        if (side === "SELL" && tp > 0 && tp >= price) throw new Error("SELL: take-profit must be below the limit price");
      }
      return placeOrder({
        symbol: symbol.trim(),
        side,
        quantity: qty,
        orderType: type as "MKT" | "LMT" | "STP",
        price: type === "MKT" ? undefined : price,
        stopLoss: stop > 0 ? stop : undefined,
        takeProfit: tp > 0 ? tp : undefined,
      });
    },
    onSuccess: (result) => {
      toast.success(`${side} ${qty} ${symbol} sent to IBKR — #${result.orderId} (${result.status})`);
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-positions"] });
      qc.invalidateQueries({ queryKey: ["ibkr-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Order failed"),
  });

  const confirmAndPlace = () => {
    const priceLabel = type === "MKT" ? "market price" : `$${price}`;
    const extras = [
      stop > 0 ? `SL $${stop}` : null,
      tp > 0 ? `TP $${tp}` : null,
    ].filter(Boolean).join(", ");
    const msg = `${side} ${qty} ${symbol} @ ${priceLabel}${extras ? ` (${extras})` : ""} — send to IBKR ${isPaper ? "paper" : "LIVE"} account ${currentAccount}?`;
    if (window.confirm(msg)) order.mutate();
  };

  const reconnect = async () => {
    try {
      await tickle();
      await ensureSession(true);
      qc.invalidateQueries();
      toast.success("Session refreshed");
    } catch (e: any) {
      toast.error(e?.message ?? "Reconnect failed — log in to the gateway");
    }
  };

  const est = qty * price;
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
              <div className="text-sm font-medium">{isPaper ? "Paper Account" : "Live Trading"}</div>
              <div className="text-[11px] text-muted-foreground">
                {!paperConfigured
                  ? "Set VITE_IBKR_PAPER_ACCOUNT_ID to enable paper mode"
                  : isPaper
                    ? "Uses your paper account — the gateway must be logged into it"
                    : "Real money — orders execute on IBKR"}
              </div>
            </div>
            <button
              onClick={() => { setIsPaper(!isPaper); qc.invalidateQueries(); }}
              disabled={!paperConfigured}
              className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed ${isPaper ? "bg-warn" : "bg-bull glow-bull"}`}>
              <span className="absolute top-0.5 h-5 w-5 rounded-full bg-background transition" style={{ left: isPaper ? 2 : 22 }} />
            </button>
          </div>

          {!connected && (
            <a href={GATEWAY_LOGIN_URL} target="_blank" rel="noreferrer"
              className="mt-3 flex items-center justify-center gap-2 h-10 rounded-lg bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition">
              <ExternalLink className="h-3.5 w-3.5" /> Log in to IBKR Gateway
            </a>
          )}

          <div className="mt-3 flex gap-2">
            <button onClick={reconnect}
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

        {fromAlert && (
          <div className="mb-3 rounded-lg bg-info/10 border border-info/20 px-3 py-2 text-[11px] text-info flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 shrink-0" />
            <span>Pre-filled from a TradeScope alert — review the levels, then confirm to send to IBKR.</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setSide("BUY")} className={`h-10 rounded-lg text-sm font-bold transition ${side === "BUY" ? "bg-bull text-background glow-bull" : "hairline bg-surface-1 text-muted-foreground"}`}>BUY</button>
          <button onClick={() => setSide("SELL")} className={`h-10 rounded-lg text-sm font-bold transition ${side === "SELL" ? "bg-bear text-background glow-bear" : "hairline bg-surface-1 text-muted-foreground"}`}>SELL</button>
        </div>

        <div className="space-y-3">
          <Row label="Symbol">
            <SymbolPicker value={symbol} onChange={changeSymbol} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm font-semibold focus:outline-none" />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Quantity">
              <input type="number" value={qty} onChange={(e) => setQty(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
            </Row>
            <Row label="Order Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
                <option>MKT</option><option>LMT</option><option>STP</option>
              </select>
            </Row>
          </div>
          {type !== "MKT" && (
            <Row label={type === "STP" ? "Stop Trigger Price" : "Limit Price"}>
              <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num focus:outline-none" />
            </Row>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Row label="Stop Loss (bracket)">
              <input type="number" min={0} step="0.01" value={stop} onChange={(e) => setStop(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bear focus:outline-none" />
            </Row>
            <Row label="Take Profit (bracket)">
              <input type="number" min={0} step="0.01" value={tp} onChange={(e) => setTp(+e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num text-bull focus:outline-none" />
            </Row>
          </div>
        </div>

        <div className="mt-5 rounded-xl hairline bg-surface-1 p-4 space-y-2 text-xs">
          {type !== "MKT" && price > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Estimated cost</span><span className="num font-semibold">${est.toLocaleString()}</span></div>
          )}
          {stop > 0 && tp > 0 && price > stop && (
            <div className="flex justify-between"><span className="text-muted-foreground">Reward / Risk</span><span className="num text-bull">{((tp - price) / (price - stop)).toFixed(2)}R</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">Buying power used</span><span className="num">{summary?.buyingPower && est > 0 ? ((est / summary.buyingPower) * 100).toFixed(1) : "—"}%</span></div>
        </div>

        <button
          onClick={confirmAndPlace}
          disabled={order.isPending || !connected}
          className={`mt-4 w-full h-11 rounded-lg text-sm font-bold tracking-wide ${side === "BUY" ? "bg-bull glow-bull" : "bg-bear glow-bear"} text-background disabled:opacity-50 inline-flex items-center justify-center gap-2`}
        >
          {order.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{side} {qty} {symbol}{type === "MKT" ? " MKT" : price > 0 ? ` @ $${price}` : ""}</>}
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
