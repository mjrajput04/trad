import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LiveDot } from "@/components/Delta";
import { Check, ExternalLink, Plug, RefreshCw, Shield, Zap, Loader2, X, AlertTriangle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { getAccountSummary, getAuthStatus, placeOrder, tickle, ensureSession, getQuotes, verifyOrderLive, GATEWAY_LOGIN_URL } from "@/lib/api/ibkr";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { SymbolPicker } from "@/components/SymbolPicker";
import { toast } from "sonner";

// Are we in IBKR's extended session (pre-market 4:00–9:30 or after-hours
// 16:00–20:00 ET on a weekday)? Outside RTH, a plain LMT is ignored unless the
// order carries the outsideRTH flag, and MKT orders aren't accepted at all.
function inExtendedHours(): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return (mins >= 4 * 60 && mins < 9 * 60 + 30) || (mins >= 16 * 60 && mins < 20 * 60);
}

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
  // Extended-hours execution (pre/after market). Defaults ON when we're in an
  // extended session so a pre/after-market order actually executes.
  const [afterHours, setAfterHours] = useState<boolean>(() => inExtendedHours());
  // GTC by default: a DAY order expires at the close; "I set it and it never
  // filled the next day" is exactly the silent-death trap we're closing.
  const [tif, setTif] = useState<"DAY" | "GTC">("GTC");

  // Live price for the selected symbol — shown next to the ticket and used to
  // auto-fill sensible levels when you pick a new stock.
  const { data: liveQuote } = useQuery({
    queryKey: ["order-quote", symbol],
    queryFn: () => getQuotes([symbol]),
    enabled: symbol.trim().length > 0,
    refetchInterval: 3_000,
  });
  const q = liveQuote?.[0];
  const nowPrice = q?.last ?? 0;
  const nowChange = q?.changePct ?? 0;

  // When you pick a NEW symbol, auto-fill the limit price at the live price and
  // suggest a 2% stop / 3% target (mirrored for a short). You can adjust or
  // clear these before sending. Skips when the ticket was prefilled by an alert.
  const autofilledFor = useRef<string>(fromAlert ? symbol : "");
  useEffect(() => {
    if (nowPrice > 0 && autofilledFor.current !== symbol) {
      autofilledFor.current = symbol;
      const p = Number(nowPrice.toFixed(2));
      setPrice(p);
      if (side === "BUY") {
        setStop(Number((p * 0.98).toFixed(2)));
        setTp(Number((p * 1.03).toFixed(2)));
      } else {
        setStop(Number((p * 1.02).toFixed(2)));
        setTp(Number((p * 0.97).toFixed(2)));
      }
    }
  }, [nowPrice, symbol, side]);

  // Changing the symbol drops the old (alert) levels; the effect above then
  // re-fills from the new stock's live price.
  const changeSymbol = (s: string) => {
    setSymbol(s);
    setPrice(0);
    setStop(0);
    setTp(0);
    setFromAlert(false);
    autofilledFor.current = "";
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
      if (afterHours && type === "MKT") throw new Error("After-hours ma LIMIT order j chale — LMT select karo");
      return placeOrder({
        symbol: symbol.trim(),
        side,
        quantity: qty,
        orderType: type as "MKT" | "LMT" | "STP",
        price: type === "MKT" ? undefined : price,
        stopLoss: stop > 0 ? stop : undefined,
        takeProfit: tp > 0 ? tp : undefined,
        tif: type === "MKT" ? "DAY" : tif,
        outsideRth: afterHours && type === "LMT",
      });
    },
    onSuccess: (result) => {
      toast.success(`${side} ${qty} ${symbol} sent to IBKR — #${result.orderId} (${result.status})`);
      // The gateway can ACK an order and still silently drop it (dead bridge) —
      // confirm it actually exists in the real order book.
      verifyOrderLive(result.orderId).then((st) => {
        if (st) toast.success(`✅ ${symbol} order IBKR par LIVE che (${st})`, { duration: 8000 });
        else toast.error(`⚠️ ${symbol} order IBKR order book ma NATHI dekhato — Orders page check karo, jarur pade FARI muko!`, { duration: 20000 });
      });
      qc.invalidateQueries({ queryKey: ["ibkr-orders"] });
      qc.invalidateQueries({ queryKey: ["ibkr-positions"] });
      qc.invalidateQueries({ queryKey: ["ibkr-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Order failed"),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  const confirmAndPlace = () => {
    if (!symbol.trim()) { toast.error("Enter a symbol"); return; }
    if (!qty || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    if (type !== "MKT" && (!price || price <= 0)) { toast.error(`${type} orders need a price`); return; }
    setConfirmOpen(true);
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

          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl hairline bg-surface-1 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{isPaper ? "Paper Account" : "Live Trading"}</div>
              <div className="text-[11px] text-muted-foreground">
                {!paperConfigured
                  ? "Real money — orders execute on IBKR. (No paper account linked.)"
                  : isPaper
                    ? "Uses your paper account — the gateway must be logged into it"
                    : "Real money — orders execute on IBKR"}
              </div>
            </div>
            {paperConfigured ? (
              <button
                onClick={() => { setIsPaper(!isPaper); qc.invalidateQueries(); }}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${isPaper ? "bg-warn" : "bg-bull glow-bull"}`}>
                <span className="absolute top-0.5 h-5 w-5 rounded-full bg-background transition" style={{ left: isPaper ? 2 : 22 }} />
              </button>
            ) : (
              <span className="shrink-0 rounded-md bg-bull/15 text-bull text-[10px] font-bold px-2 py-1">LIVE</span>
            )}
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
            {nowPrice > 0 && (
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">Current price</span>
                <span className="num font-semibold">${fmtMoney(nowPrice)}</span>
                <span className={`num ${nowChange >= 0 ? "text-bull" : "text-bear"}`}>
                  {nowChange >= 0 ? "+" : ""}{nowChange.toFixed(2)}%
                </span>
                <button
                  type="button"
                  onClick={() => { const p = Number(nowPrice.toFixed(2)); setPrice(p); if (side === "BUY") { setStop(Number((p * 0.98).toFixed(2))); setTp(Number((p * 1.03).toFixed(2))); } else { setStop(Number((p * 1.02).toFixed(2))); setTp(Number((p * 0.97).toFixed(2))); } }}
                  className="ml-auto text-primary hover:underline"
                >
                  Use live price
                </button>
              </div>
            )}
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

          {/* Extended-hours execution (pre-market / after-hours) */}
          <label className="flex items-center gap-2 text-[11px] cursor-pointer rounded-lg hairline bg-surface-1 px-3 py-2">
            <input
              type="checkbox"
              checked={afterHours}
              onChange={(e) => { setAfterHours(e.target.checked); if (e.target.checked && type === "MKT") setType("LMT"); }}
            />
            <span>
              <span className="font-semibold">After-hours execution</span>
              <span className="text-muted-foreground"> — pre-market 4:00–9:30 / after-hours 16:00–20:00 ET. LIMIT only; liquidity patlu, limit price barabar mukvo.</span>
            </span>
          </label>

          {/* GTC vs DAY */}
          {type !== "MKT" && (
            <label className="flex items-center gap-2 text-[11px] cursor-pointer rounded-lg hairline bg-surface-1 px-3 py-2">
              <input type="checkbox" checked={tif === "GTC"} onChange={(e) => setTif(e.target.checked ? "GTC" : "DAY")} />
              <span>
                <span className="font-semibold">GTC — order expire NAHI thay</span>
                <span className="text-muted-foreground"> — fill na thay tya sudhi roj live rahe (logout/app bandh thi farak nahi). Off karo to aaje close par mari jase.</span>
              </span>
            </label>
          )}

          {/* Limit won't fill NOW warning — the "GOOGL 332 didn't buy" trap */}
          {type === "LMT" && price > 0 && nowPrice > 0 &&
            ((side === "BUY" && price < nowPrice) || (side === "SELL" && price > nowPrice)) && (
            <div className="rounded-lg bg-warn/10 border border-warn/20 px-3 py-2 text-[11px] text-warn flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {side === "BUY"
                  ? <>Limit <span className="num font-semibold">${price}</span> atyar na bhaav <span className="num font-semibold">${fmtMoney(nowPrice)}</span> thi NICHE che — <span className="font-semibold">atyare fill NAHI thay</span>, price niche aave tyare j. Turant kharidva "Use live price" dabao ke limit ${fmtMoney(nowPrice)} kar.</>
                  : <>Limit <span className="num font-semibold">${price}</span> atyar na bhaav <span className="num font-semibold">${fmtMoney(nowPrice)}</span> thi UPAR che — <span className="font-semibold">atyare fill NAHI thay</span>. Turant vechva limit ${fmtMoney(nowPrice)} ke niche kar.</>}
              </span>
            </div>
          )}
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

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl glass hairline p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-info" />
              <h3 className="text-base font-semibold">Confirm order</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Sending to IBKR {isPaper ? "paper" : "live"} account <span className="num">{currentAccount}</span>.
            </p>

            <div className="rounded-xl hairline bg-surface-1 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-lg font-bold ${side === "BUY" ? "text-bull" : "text-bear"}`}>{side}</span>
                <span className="text-lg font-bold num">{qty} {symbol}</span>
              </div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Order type</span><span className="num">{type === "MKT" ? "Market" : `${type} @ $${fmtMoney(price)}`}</span></div>
              {type !== "MKT" && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Time in force</span><span className="num">{tif === "GTC" ? "GTC · till filled" : "DAY · expires at close"}</span></div>}
              {afterHours && type === "LMT" && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Session</span><span className="num text-warn">Extended (pre/after-hours)</span></div>}
              {nowPrice > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Current price</span><span className="num">${fmtMoney(nowPrice)}</span></div>}
              {stop > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Stop loss</span><span className="num text-bear">${fmtMoney(stop)}</span></div>}
              {tp > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Take profit</span><span className="num text-bull">${fmtMoney(tp)}</span></div>}
              {type !== "MKT" && price > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Estimated cost</span><span className="num">${est.toLocaleString()}</span></div>}
            </div>

            {!isPaper && (
              <div className="mt-3 rounded-lg bg-bear/10 border border-bear/20 px-3 py-2 text-[11px] text-bear flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Live account — this places a real-money order.
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 h-10 rounded-lg hairline bg-surface-1 hover:bg-surface-2 text-sm font-semibold">Cancel</button>
              <button
                onClick={() => { setConfirmOpen(false); order.mutate(); }}
                disabled={order.isPending}
                className={`flex-1 h-10 rounded-lg text-sm font-bold text-background ${side === "BUY" ? "bg-bull glow-bull" : "bg-bear glow-bear"} disabled:opacity-50 inline-flex items-center justify-center gap-2`}
              >
                {order.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm ${side}`}
              </button>
            </div>
          </div>
        </div>
      )}
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
