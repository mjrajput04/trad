import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, Coins, Loader2, X, Zap } from "lucide-react";
import {
  getOptionMeta, getOptionChain, getOptionQuotes, getQuotes, placeOrder, findOptionPlay,
  type OptionContract, type OptionQuote,
} from "@/lib/api/ibkr";
import { getTsAlerts, type TsAlert } from "@/lib/api/alerts";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Level, LevelBar } from "@/components/TradeLevels";
import { useTrading } from "@/lib/trading-context";
import { fmtMoney } from "@/lib/market-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/options")({
  head: () => ({ meta: [{ title: "F&O Options · NOVA" }, { name: "description", content: "Live IBKR option chain with one-tap trading." }] }),
  component: OptionsPage,
});

const fmtExpiry = (ymd: string) => {
  if (!ymd || ymd.length !== 8) return ymd;
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T12:00:00`);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit" });
};

function OptionsPage() {
  const [symbol, setSymbol] = useState("SPY");
  const [month, setMonth] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");
  const [trade, setTrade] = useState<{ c: OptionContract; q?: OptionQuote } | null>(null);

  // Underlying conid + option months
  const { data: meta, isLoading: metaLoading, isError: metaError } = useQuery({
    queryKey: ["opt-meta", symbol],
    queryFn: () => getOptionMeta(symbol),
    enabled: symbol.trim().length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const activeMonth = month && meta?.months.includes(month) ? month : meta?.months[0] ?? "";

  // Live spot for the underlying (per-second)
  const { data: spotQuotes } = useQuery({
    queryKey: ["order-quote", symbol],
    queryFn: () => getQuotes([symbol]),
    enabled: symbol.trim().length > 0,
    refetchInterval: 1_000,
  });
  const spot = spotQuotes?.[0]?.last ?? 0;
  const spotChg = spotQuotes?.[0]?.changePct ?? 0;

  // Chain (strikes + contracts) for the chosen month
  const { data: chain, isFetching: chainLoading } = useQuery({
    queryKey: ["opt-chain", meta?.conid, activeMonth],
    queryFn: () => getOptionChain(meta!.conid, activeMonth, spot || 0),
    enabled: !!meta?.conid && !!activeMonth && spot > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const expiries = useMemo(
    () => [...new Set((chain?.contracts ?? []).map((c) => c.maturityDate))].sort(),
    [chain]
  );
  const activeExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0] ?? "";

  const rows = useMemo(() => {
    const byStrike = new Map<number, { call?: OptionContract; put?: OptionContract }>();
    for (const c of chain?.contracts ?? []) {
      if (c.maturityDate !== activeExpiry) continue;
      const row = byStrike.get(c.strike) ?? {};
      if (c.right === "C") row.call = c;
      else row.put = c;
      byStrike.set(c.strike, row);
    }
    return [...byStrike.entries()].sort(([a], [b]) => a - b);
  }, [chain, activeExpiry]);

  // Live option quotes for the visible contracts
  const visibleConids = useMemo(
    () => rows.flatMap(([, r]) => [r.call?.conid, r.put?.conid]).filter(Boolean) as number[],
    [rows]
  );
  const { data: optQuotes = [] } = useQuery({
    queryKey: ["opt-quotes", visibleConids.join(",")],
    queryFn: () => getOptionQuotes(visibleConids),
    enabled: visibleConids.length > 0,
    refetchInterval: 1_000, // per-second, like the rest of the terminal
  });
  const quoteByConid = new Map(optQuotes.map((q) => [q.conid, q]));

  // ATM strike (closest to spot)
  const atm = rows.length
    ? rows.reduce((best, [k]) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best), rows[0][0])
    : 0;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Coins className="h-5 w-5 text-info" /> F&O — Options Chain
          </h1>
          <p className="text-sm text-muted-foreground">Live IBKR option chain — tap a Call or Put to trade it.</p>
        </div>
        {spot > 0 && (
          <div className="text-right">
            <div className="text-lg font-bold num">{symbol} ${fmtMoney(spot)}</div>
            <div className={`text-xs num ${spotChg >= 0 ? "text-bull" : "text-bear"}`}>{spotChg >= 0 ? "+" : ""}{spotChg.toFixed(2)}%</div>
          </div>
        )}
      </div>

      {/* AI F&O signals — derived from the same 5-gate stock engine */}
      <FnoSignals onTrade={(c, q) => setTrade({ c, q })} />

      {/* Controls */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Underlying</div>
          <SymbolPicker value={symbol} onChange={(s) => { setSymbol(s); setMonth(""); setExpiry(""); }} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm font-semibold focus:outline-none" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Month</div>
          <select value={activeMonth} onChange={(e) => { setMonth(e.target.value); setExpiry(""); }} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
            {(meta?.months ?? []).slice(0, 8).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Expiry</div>
          <select value={activeExpiry} onChange={(e) => setExpiry(e.target.value)} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
            {expiries.map((x) => <option key={x} value={x}>{fmtExpiry(x)}</option>)}
          </select>
        </div>
      </div>

      {/* Chain */}
      {metaLoading || (chainLoading && rows.length === 0) ? (
        <div className="rounded-2xl glass p-14 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
          Loading option chain from IBKR… (first load takes ~10s)
        </div>
      ) : metaError || (meta === null) ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">No options found for {symbol}</div>
          <div className="text-muted-foreground text-xs">Make sure the IBKR gateway is logged in, or try another symbol.</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl glass p-10 text-center text-sm text-muted-foreground">No contracts for this expiry.</div>
      ) : (
        <div className="rounded-2xl glass overflow-hidden">
          <div className="grid grid-cols-9 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground hairline-b bg-surface-1/60 text-center">
            <div className="col-span-4 text-bull font-bold">CALLS</div>
            <div>Strike</div>
            <div className="col-span-4 text-bear font-bold">PUTS</div>
          </div>
          <div className="grid grid-cols-9 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hairline-b text-center">
            <div>Δ</div><div>Last</div><div>Bid</div><div>Ask</div>
            <div></div>
            <div>Bid</div><div>Ask</div><div>Last</div><div>Δ</div>
          </div>
          {rows.map(([strike, r]) => {
            const cq = r.call ? quoteByConid.get(r.call.conid) : undefined;
            const pq = r.put ? quoteByConid.get(r.put.conid) : undefined;
            const isAtm = strike === atm;
            const cell = "py-2 text-center num text-xs";
            return (
              <div key={strike} className={`grid grid-cols-9 hairline-b last:border-0 items-center ${isAtm ? "bg-primary/10" : ""}`}>
                <button onClick={() => r.call && setTrade({ c: r.call, q: cq })} disabled={!r.call}
                  className="col-span-4 grid grid-cols-4 hover:bg-bull/10 transition cursor-pointer disabled:opacity-30">
                  <div className={`${cell} text-muted-foreground`}>{cq?.delta ? cq.delta.toFixed(2) : "—"}</div>
                  <div className={cell}>{cq?.last ? fmtMoney(cq.last) : "—"}</div>
                  <div className={`${cell} text-bull`}>{cq?.bid ? fmtMoney(cq.bid) : "—"}</div>
                  <div className={`${cell} text-bull`}>{cq?.ask ? fmtMoney(cq.ask) : "—"}</div>
                </button>
                <div className={`py-2 text-center text-xs font-bold ${isAtm ? "text-primary" : ""}`}>{strike}{isAtm && <span className="block text-[8px] font-normal text-muted-foreground">ATM</span>}</div>
                <button onClick={() => r.put && setTrade({ c: r.put, q: pq })} disabled={!r.put}
                  className="col-span-4 grid grid-cols-4 hover:bg-bear/10 transition cursor-pointer disabled:opacity-30">
                  <div className={`${cell} text-bear`}>{pq?.bid ? fmtMoney(pq.bid) : "—"}</div>
                  <div className={`${cell} text-bear`}>{pq?.ask ? fmtMoney(pq.ask) : "—"}</div>
                  <div className={cell}>{pq?.last ? fmtMoney(pq.last) : "—"}</div>
                  <div className={`${cell} text-muted-foreground`}>{pq?.delta ? pq.delta.toFixed(2) : "—"}</div>
                </button>
              </div>
            );
          })}
          <div className="px-4 py-2 text-[10px] text-muted-foreground">
            Live from IBKR · greeks: Δ delta · quotes tick every ~1s · 1 contract = 100 shares
          </div>
        </div>
      )}

      {trade && (
        <OptionTradeModal
          symbol={symbol}
          contract={trade.c}
          quote={trade.q}
          onClose={() => setTrade(null)}
        />
      )}
    </div>
  );
}

// ---- AI F&O signals: the engine's working stock alerts expressed as options ----
// A working BUY alert → slightly-ITM CALL (7–35d expiry). Market falling hard
// (SPY ≤ −0.3%) → slightly-ITM SPY PUT. Premium target/stop are delta-mapped
// from the underlying alert levels. Same silent gate: nothing strong → hidden.
interface FnoSignal {
  key: string;
  label: string;         // e.g. "NVDA CALL"
  contract: OptionContract & { underlyingConid: number };
  alert?: TsAlert;       // source stock alert (for CALLs)
  underlying: string;
  score?: number;
}

function FnoSignals({ onTrade }: { onTrade: (c: OptionContract, q?: OptionQuote) => void }) {
  // Working stock alerts from the engine (same validity gate as the alerts page)
  const { data: ts } = useQuery({ queryKey: ["ts-alerts"], queryFn: getTsAlerts, refetchInterval: 30_000 });
  const alerts = (ts?.alerts ?? []).filter((a) => a?.symbol && Number(a.entry) > 0).slice(0, 4);

  // Underlying live quotes (alert symbols + SPY for the bearish case)
  const underlyings = [...new Set([...alerts.map((a) => a.symbol), "SPY"])];
  const { data: uq = [] } = useQuery({
    queryKey: ["fno-underlying", underlyings.join(",")],
    queryFn: () => getQuotes(underlyings),
    enabled: underlyings.length > 0,
    refetchInterval: 1_000,
  });
  const uBySym = new Map(uq.map((q) => [q.symbol, q]));
  const spy = uBySym.get("SPY");
  const marketFalling = (spy?.changePct ?? 0) <= -0.3;

  // Resolve one option contract per signal (cached — contract ids don't move)
  const sigKey = alerts.map((a) => a.symbol).join(",") + (marketFalling ? "+SPYPUT" : "");
  const { data: signals = [], isFetching } = useQuery({
    queryKey: ["fno-signals", sigKey],
    queryFn: async () => {
      const out: FnoSignal[] = [];
      for (const a of alerts) {
        const u = uBySym.get(a.symbol);
        const c = await findOptionPlay(a.symbol, "C", u?.last || a.entry).catch(() => null);
        if (c) out.push({ key: `${a.symbol}-C`, label: `${a.symbol} CALL`, contract: c, alert: a, underlying: a.symbol, score: a.score });
      }
      if (marketFalling && spy?.last) {
        const c = await findOptionPlay("SPY", "P", spy.last).catch(() => null);
        if (c) out.push({ key: "SPY-P", label: "SPY PUT", contract: c, underlying: "SPY" });
      }
      return out;
    },
    enabled: alerts.length > 0 || marketFalling,
    staleTime: 5 * 60_000,
  });

  // Live premiums for the signal contracts (per-second)
  const conids = signals.map((s) => s.contract.conid);
  const { data: prem = [] } = useQuery({
    queryKey: ["fno-signal-quotes", conids.join(",")],
    queryFn: () => getOptionQuotes(conids),
    enabled: conids.length > 0,
    refetchInterval: 1_000,
  });
  const premByConid = new Map(prem.map((q) => [q.conid, q]));

  if (!signals.length && !isFetching) return null;

  return (
    <section className="rounded-2xl glass p-5 border border-info/20">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-info" />
        <h2 className="text-sm font-semibold">AI F&O Signals</h2>
        <span className="text-[11px] text-muted-foreground">
          {isFetching && !signals.length ? "resolving contracts…" : `${signals.length} active · from the same 5-gate engine`}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 mb-3">
        Each working stock alert expressed as a slightly-ITM option (7–35 day expiry). Premium target/stop are
        delta-mapped estimates from the stock's levels. Options move fast — same 1%-risk discipline applies.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => {
          const q = premByConid.get(s.contract.conid);
          const u = uBySym.get(s.underlying);
          const mid = q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q?.last ?? 0;
          const delta = Math.abs(q?.delta ?? (s.contract.right === "C" ? 0.6 : -0.6));
          // Delta-mapped premium levels from the underlying alert (est.)
          let tgt = 0, stp = 0;
          if (s.alert && u?.last && mid > 0) {
            tgt = Math.max(0.01, mid + delta * (s.alert.target - u.last));
            stp = Math.max(0.01, mid - delta * (u.last - s.alert.stop));
          } else if (mid > 0 && u?.last) {
            // SPY PUT default: ±1.5% underlying move mapped through delta
            tgt = mid + delta * (u.last * 0.015);
            stp = Math.max(0.01, mid - delta * (u.last * 0.01));
          }
          const isCall = s.contract.right === "C";
          return (
            <div key={s.key} className="rounded-2xl glass p-4 flex flex-col gap-3 border border-surface-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold ${isCall ? "text-bull" : "text-bear"}`}>{s.label}</span>
                  {s.score != null && <span className="rounded-md bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.5">Score {Math.round(s.score)}</span>}
                </div>
                {q?.iv ? <span className="text-[10px] text-muted-foreground num">IV {q.iv.toFixed(0)}%</span> : null}
              </div>
              <div className="text-[11px] text-muted-foreground -mt-2">
                ${s.contract.strike} strike · exp {fmtExpiry(s.contract.maturityDate)} · Δ {q?.delta ? q.delta.toFixed(2) : "—"}
                {u?.last ? <> · {s.underlying} ${fmtMoney(u.last)}</> : null}
              </div>
              {mid > 0 && tgt > 0 ? (
                <>
                  <div className="flex gap-2">
                    <Level label="Premium" value={mid} tone="info" />
                    <Level label="Target ≈" value={tgt} sub={`+${(((tgt - mid) / mid) * 100).toFixed(0)}%`} tone="bull" />
                    <Level label="Stop ≈" value={stp} sub={`${(((stp - mid) / mid) * 100).toFixed(0)}%`} tone="bear" />
                  </div>
                  <LevelBar entry={mid} target={tgt} stop={stp} now={q?.last || mid} />
                </>
              ) : (
                <div className="text-[11px] text-muted-foreground py-2">Waiting for live premium…</div>
              )}
              {s.alert?.reasons?.length ? (
                <div className="flex flex-wrap gap-1">
                  {s.alert.reasons.slice(0, 3).map((r, i) => (
                    <span key={i} className="text-[10px] rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground">{r}</span>
                  ))}
                </div>
              ) : !isCall ? (
                <div className="text-[10px] rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground w-fit">Market falling — bearish index play</div>
              ) : null}
              <button
                onClick={() => onTrade(s.contract, q)}
                className={`mt-auto h-9 rounded-lg text-sm font-bold text-background inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition ${isCall ? "bg-bull glow-bull" : "bg-bear glow-bear"}`}
              >
                <Zap className="h-4 w-4" /> Trade {s.label}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- one-tap option order popup ----
function OptionTradeModal({ symbol, contract, quote, onClose }: {
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
