import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, Coins, Loader2, Sparkles, ArrowRight } from "lucide-react";
import {
  getOptionMeta, getOptionStrikes, pickNearestStrikes, resolveOptionContracts,
  getOptionQuotes, getQuotes, type OptionContract, type OptionQuote,
} from "@/lib/api/ibkr";
import { SymbolPicker } from "@/components/SymbolPicker";
import { OptionTradeModal, fmtExpiry } from "@/components/OptionTradeModal";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/options")({
  head: () => ({ meta: [{ title: "F&O Options · NOVA" }, { name: "description", content: "Live IBKR option chain with one-tap trading." }] }),
  component: OptionsPage,
});

const SPAN = 6; // strikes each side of ATM

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

  // 1) Strikes for the month — ONE fast round-trip; the ladder can render from
  // this before any contract ids resolve, so there's no 10s blank spinner.
  const { data: strikes = [], isLoading: strikesLoading } = useQuery({
    queryKey: ["opt-strikes", meta?.conid, activeMonth],
    queryFn: () => getOptionStrikes(meta!.conid, activeMonth),
    enabled: !!meta?.conid && !!activeMonth,
    staleTime: 10 * 60_000,
    retry: false,
  });

  // ATM anchor — a stable strike value that only changes when spot crosses to a
  // new nearest strike, so the picked window (and the contracts query key) don't
  // churn every second as the price ticks.
  const anchor = useMemo(() => {
    if (!strikes.length) return 0;
    if (spot <= 0) return strikes[Math.floor(strikes.length / 2)];
    return strikes.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best), strikes[0]);
  }, [strikes, spot]);

  const pickedStrikes = useMemo(() => {
    if (!strikes.length) return [];
    if (!anchor) return pickNearestStrikes(strikes, 0, SPAN);
    const i = strikes.indexOf(anchor);
    return strikes.slice(Math.max(0, i - SPAN), i + SPAN + 1);
  }, [strikes, anchor]);

  // 2) Resolve call+put contract ids for the picked strikes (cached per
  // underlying, so re-opening the chain is instant).
  const { data: contracts = [], isFetching: contractsLoading } = useQuery({
    queryKey: ["opt-contracts", meta?.conid, activeMonth, pickedStrikes.join(",")],
    queryFn: () => resolveOptionContracts(meta!.conid, activeMonth, pickedStrikes),
    enabled: !!meta?.conid && !!activeMonth && pickedStrikes.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const expiries = useMemo(
    () => [...new Set(contracts.map((c) => c.maturityDate))].filter(Boolean).sort(),
    [contracts]
  );
  const activeExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0] ?? "";

  // call/put contract per strike for the active expiry
  const byStrikeRight = useMemo(() => {
    const m = new Map<string, OptionContract>();
    for (const c of contracts) {
      if (c.maturityDate !== activeExpiry) continue;
      m.set(`${c.strike}:${c.right}`, c);
    }
    return m;
  }, [contracts, activeExpiry]);

  const rows = pickedStrikes.map((strike) => ({
    strike,
    call: byStrikeRight.get(`${strike}:C`),
    put: byStrikeRight.get(`${strike}:P`),
  }));

  // Live option quotes for the visible contracts
  const visibleConids = useMemo(
    () => rows.flatMap((r) => [r.call?.conid, r.put?.conid]).filter(Boolean) as number[],
    [rows]
  );
  const { data: optQuotes = [] } = useQuery({
    queryKey: ["opt-quotes", visibleConids.join(",")],
    queryFn: () => getOptionQuotes(visibleConids),
    enabled: visibleConids.length > 0,
    refetchInterval: 1_000,
  });
  const quoteByConid = new Map(optQuotes.map((q) => [q.conid, q]));

  const atm = anchor;
  const showLadder = rows.length > 0;

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

      {/* AI F&O signals live on their own page now */}
      <Link
        to="/fno-alerts"
        className="flex items-center justify-between rounded-2xl glass p-4 border border-info/20 hover:ring-1 hover:ring-info/40 transition group"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-info/15 grid place-items-center">
            <Sparkles className="h-4 w-4 text-info" />
          </div>
          <div>
            <div className="text-sm font-semibold">AI F&O Alerts</div>
            <div className="text-[11px] text-muted-foreground">Ready-made call / put signals from the same 5-gate engine — premium entry, target &amp; stop.</div>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-info transition" />
      </Link>

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
          <select value={activeExpiry} onChange={(e) => setExpiry(e.target.value)} disabled={expiries.length === 0} className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none disabled:opacity-50">
            {expiries.length === 0 ? <option>—</option> : expiries.map((x) => <option key={x} value={x}>{fmtExpiry(x)}</option>)}
          </select>
        </div>
      </div>

      {/* Chain */}
      {(metaLoading || strikesLoading) && !showLadder ? (
        <div className="rounded-2xl glass p-14 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
          Loading strikes from IBKR…
        </div>
      ) : metaError || meta === null ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">No options found for {symbol}</div>
          <div className="text-muted-foreground text-xs">Make sure the IBKR gateway is logged in, or try another symbol.</div>
        </div>
      ) : !showLadder ? (
        <div className="rounded-2xl glass p-10 text-center text-sm text-muted-foreground">No strikes for this month.</div>
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
          {rows.map(({ strike, call, put }) => {
            const cq = call ? quoteByConid.get(call.conid) : undefined;
            const pq = put ? quoteByConid.get(put.conid) : undefined;
            const isAtm = strike === atm;
            const cell = "py-2 text-center num text-xs";
            return (
              <div key={strike} className={`grid grid-cols-9 hairline-b last:border-0 items-center ${isAtm ? "bg-primary/10" : ""}`}>
                <button onClick={() => call && setTrade({ c: call, q: cq })} disabled={!call}
                  className="col-span-4 grid grid-cols-4 hover:bg-bull/10 transition cursor-pointer disabled:opacity-30 disabled:cursor-default">
                  <div className={`${cell} text-muted-foreground`}>{cq?.delta ? cq.delta.toFixed(2) : "—"}</div>
                  <div className={cell}>{cq?.last ? fmtMoney(cq.last) : "—"}</div>
                  <div className={`${cell} text-bull`}>{cq?.bid ? fmtMoney(cq.bid) : "—"}</div>
                  <div className={`${cell} text-bull`}>{cq?.ask ? fmtMoney(cq.ask) : "—"}</div>
                </button>
                <div className={`py-2 text-center text-xs font-bold ${isAtm ? "text-primary" : ""}`}>{strike}{isAtm && <span className="block text-[8px] font-normal text-muted-foreground">ATM</span>}</div>
                <button onClick={() => put && setTrade({ c: put, q: pq })} disabled={!put}
                  className="col-span-4 grid grid-cols-4 hover:bg-bear/10 transition cursor-pointer disabled:opacity-30 disabled:cursor-default">
                  <div className={`${cell} text-bear`}>{pq?.bid ? fmtMoney(pq.bid) : "—"}</div>
                  <div className={`${cell} text-bear`}>{pq?.ask ? fmtMoney(pq.ask) : "—"}</div>
                  <div className={cell}>{pq?.last ? fmtMoney(pq.last) : "—"}</div>
                  <div className={`${cell} text-muted-foreground`}>{pq?.delta ? pq.delta.toFixed(2) : "—"}</div>
                </button>
              </div>
            );
          })}
          <div className="px-4 py-2 text-[10px] text-muted-foreground flex items-center gap-2">
            {contractsLoading && expiries.length === 0
              ? <><Loader2 className="h-3 w-3 animate-spin" /> resolving contracts…</>
              : <>Live from IBKR · greeks: Δ delta · quotes tick every ~1s · 1 contract = 100 shares</>}
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
