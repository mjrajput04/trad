// Shared AI F&O signal engine. Each signal is the OPTIONS expression of a
// working stock alert from the same TradeScope engine that drives the stock
// alerts page — a working BUY alert becomes a slightly-ITM CALL, and a
// genuinely falling market becomes a slightly-ITM SPY PUT. It reuses the exact
// same silent quality gate as the stock alerts (nothing sliding toward its stop
// ever shows), plus an option-level gate so a card VANISHES the moment its
// premium reaches target or stop — just like a stock alert disappearing when it
// hits its level. Premium target/stop are honest delta-mapped ESTIMATES from
// the underlying alert's levels (options add leverage + theta; not a promise).

import { useQuery } from "@tanstack/react-query";
import { getTsAlerts, type TsAlert } from "./api/alerts";
import {
  getQuotes, getOptionQuotes, findOptionPlay, getPositions,
  type OptionContract, type OptionQuote, type SymbolQuote,
} from "./api/ibkr";

const INDEX_SYMS = ["SPY", "QQQ", "DIA", "IWM"];

export interface FnoSignal {
  key: string;
  label: string;          // "NVDA CALL"
  underlying: string;
  right: "C" | "P";
  score?: number;
  contract: OptionContract & { underlyingConid?: number };
  alert?: TsAlert;
  quote?: OptionQuote;
  underlyingQuote?: SymbolQuote;
  premium: number;        // live mid (or last)
  target: number;         // delta-mapped estimate
  stop: number;           // delta-mapped estimate
  delta: number;
  iv?: number;
  reasons: string[];
  ready: boolean;         // premium known → levels are live
  held: boolean;          // you hold this exact contract → card never hides
}

export interface FnoContext {
  signals: FnoSignal[];
  best: FnoSignal | null;
  isFetching: boolean;
  marketFalling: boolean;
  indexAvg: number;
  updated?: string;
  marketOpen?: boolean;
  closedUnderlying: TsAlert[];
}

export function useFnoSignals(): FnoContext {
  const { data: ts } = useQuery({ queryKey: ["ts-alerts"], queryFn: getTsAlerts, refetchInterval: 30_000 });

  // Your live IBKR positions — a HELD contract's card never hides until sold.
  const { data: positions = [] } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 15_000,
    retry: false,
  });
  const heldConids = new Set(positions.filter((p) => p.quantity > 0).map((p) => p.conid));
  // Underlyings on which you hold OPTIONS — their alerts bypass the sliding
  // gate so a held call's card can keep resolving/showing.
  const heldOptUnderlyings = new Set(
    positions.filter((p) => p.quantity > 0 && p.assetClass === "OPT").map((p) => p.symbol)
  );

  const validAlerts = (ts?.alerts ?? []).filter(
    (a) => a?.symbol && Number(a.entry) > 0 && Number.isFinite(Number(a.score))
  );

  // Live IBKR quotes for the candidate underlyings + the index basket.
  const candidateSyms = validAlerts.slice(0, 8).map((a) => a.symbol);
  const underlyings = [...new Set([...candidateSyms, ...INDEX_SYMS])];
  const { data: uq = [] } = useQuery({
    queryKey: ["fno-underlyings", underlyings.join(",")],
    queryFn: () => getQuotes(underlyings),
    enabled: underlyings.length > 0,
    refetchInterval: 1_000,
    retry: false,
  });
  const uBySym = new Map(uq.map((q) => [q.symbol, q]));
  const nowPrice = (s: string) => uBySym.get(s)?.last;

  // Market direction — the index PUT uses a stricter bar (avg ≤ −0.3%) than the
  // stock page, because a PUT is a real short: only when it's genuinely falling.
  const idx = INDEX_SYMS.map((s) => uBySym.get(s)).filter(Boolean) as SymbolQuote[];
  const indexAvg = idx.length ? idx.reduce((a, q) => a + (q.changePct || 0), 0) / idx.length : 0;
  const marketFalling = idx.length > 0 && indexAvg <= -0.3;

  // Same silent WORKING gate as the stock alerts page.
  const working = (a: TsAlert) => {
    const now = nowPrice(a.symbol);
    if (now == null || now <= 0) return true;
    if (now >= a.entry) return true;
    const span = a.entry - a.stop;
    if (span <= 0) return true;
    return (a.entry - now) / span < 0.15;
  };
  const workingAlerts = validAlerts
    .filter((a) => working(a) || heldOptUnderlyings.has(a.symbol))
    .slice(0, 6);

  // Resolve one option contract per working alert (+ SPY put when falling).
  // Cached by React Query key; contract ids don't move so this is cheap.
  const sigKey = workingAlerts.map((a) => a.symbol).join(",") + (marketFalling ? "+SPYPUT" : "");
  const { data: resolved = [], isFetching: resolving } = useQuery({
    queryKey: ["fno-contracts", sigKey],
    queryFn: async () => {
      const out: Array<Pick<FnoSignal, "key" | "label" | "underlying" | "right" | "score" | "contract" | "alert">> = [];
      for (const a of workingAlerts) {
        const u = uBySym.get(a.symbol);
        const c = await findOptionPlay(a.symbol, "C", u?.last || a.entry).catch(() => null);
        if (c) out.push({ key: `${a.symbol}-C`, label: `${a.symbol} CALL`, underlying: a.symbol, right: "C", score: a.score, contract: c, alert: a });
      }
      if (marketFalling) {
        const spy = uBySym.get("SPY");
        if (spy?.last) {
          const c = await findOptionPlay("SPY", "P", spy.last).catch(() => null);
          if (c) out.push({ key: "SPY-P", label: "SPY PUT", underlying: "SPY", right: "P", contract: c });
        }
      }
      return out;
    },
    enabled: workingAlerts.length > 0 || marketFalling,
    staleTime: 5 * 60_000,
  });

  // Live premiums + greeks for the resolved contracts (per-second).
  const conids = resolved.map((s) => s.contract.conid);
  const { data: prem = [] } = useQuery({
    queryKey: ["fno-premiums", conids.join(",")],
    queryFn: () => getOptionQuotes(conids),
    enabled: conids.length > 0,
    refetchInterval: 1_000,
  });
  const premByConid = new Map(prem.map((q) => [q.conid, q]));

  const signals: FnoSignal[] = [];
  for (const s of resolved) {
    const q = premByConid.get(s.contract.conid);
    const u = uBySym.get(s.underlying);
    const mid = q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q?.last ?? 0;
    const delta = Math.abs(q?.delta ?? (s.right === "C" ? 0.6 : -0.6)) || 0.6;

    let target = 0, stop = 0;
    if (s.alert && u?.last && mid > 0) {
      target = Math.max(0.01, mid + delta * (s.alert.target - u.last));
      stop = Math.max(0.01, mid - delta * (u.last - s.alert.stop));
    } else if (mid > 0 && u?.last) {
      // Index PUT: ±1.5% / ±1% underlying move mapped through delta.
      target = mid + delta * (u.last * 0.015);
      stop = Math.max(0.01, mid - delta * (u.last * 0.01));
    }
    const ready = mid > 0 && target > 0 && stop > 0 && target > stop;
    const held = heldConids.has(s.contract.conid);

    // OPTION-LEVEL GATE: while a premium isn't in yet, keep it visible as
    // "resolving". Once live, drop it the instant it reaches target or stop —
    // UNLESS you hold the contract: then the card stays until you sell.
    if (ready && !held) {
      const live = q?.last || mid;
      if (live >= target || live <= stop) continue; // played out → hide silently
    }

    signals.push({
      ...s,
      quote: q,
      underlyingQuote: u,
      premium: mid,
      target,
      stop,
      delta,
      iv: q?.iv,
      reasons: s.alert?.reasons ?? (s.right === "P" ? ["Market falling — bearish index play"] : []),
      ready,
      held,
    });
  }

  // Strongest first: score, then how far the premium has travelled toward target.
  signals.sort((a, b) => {
    const pa = a.ready && a.target > a.stop ? (a.premium - a.stop) / (a.target - a.stop) : 0;
    const pb = b.ready && b.target > b.stop ? (b.premium - b.stop) / (b.target - b.stop) : 0;
    return (b.score ?? 0) - (a.score ?? 0) || pb - pa;
  });

  return {
    signals,
    best: signals[0] ?? null,
    isFetching: resolving,
    marketFalling,
    indexAvg,
    updated: ts?.updated,
    marketOpen: ts?.marketOpen,
    closedUnderlying: ts?.closed ?? [],
  };
}
