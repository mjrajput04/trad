import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  AlertTriangle, Loader2, Trophy, Bell, Newspaper,
  ArrowUpRight, ArrowDownRight, Gauge, Clock, TrendingDown,
} from "lucide-react";
import {
  getTsAlerts, getTsQuotes, getTsBacktest, bracketStop,
  type TsAlert, type TsBacktest,
} from "@/lib/api/alerts";
import { getPositions, getQuotes, type Position } from "@/lib/api/ibkr";
import { QuickTradeModal, type QuickTradeDefaults } from "@/components/QuickTradeModal";
import { Level, LevelBar } from "@/components/TradeLevels";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "AI Stock Alerts · NOVA" }, { name: "description", content: "Live AI buy alerts with entry / target / stop, powered by the TradeScope engine." }] }),
  component: Alerts,
});

const money = (n?: number) => `$${fmtMoney(Number(n) || 0)}`;
const pct = (n?: number) => {
  const v = Number(n) || 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
};
const timeAgo = (iso?: string) => {
  if (!iso) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

function sentimentColor(s?: string) {
  if (s === "Bullish") return "text-bull bg-bull/15";
  if (s === "Bearish") return "text-bear bg-bear/15";
  return "text-muted-foreground bg-surface-2";
}

// Inverse ETFs rise when the market falls — buying one is a bearish play, all
// IBKR-tradable. Shown when the major indices are red so you're not stuck only
// going long into a down market.
const INVERSE_ETFS = [
  { symbol: "SH", name: "Inverse S&P 500 (1x)" },
  { symbol: "PSQ", name: "Inverse NASDAQ-100 (1x)" },
  { symbol: "DOG", name: "Inverse Dow 30 (1x)" },
  { symbol: "SQQQ", name: "Inverse NASDAQ-100 (3x)" },
  { symbol: "SPXU", name: "Inverse S&P 500 (3x)" },
  { symbol: "SDOW", name: "Inverse Dow 30 (3x)" },
];

function Alerts() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["ts-alerts"],
    queryFn: getTsAlerts,
    refetchInterval: 20_000,
  });
  const { data: quotesData } = useQuery({
    queryKey: ["ts-quotes"],
    queryFn: getTsQuotes,
    refetchInterval: 1_000, // live prices tick every second (matches the engine)
  });
  const { data: backtest } = useQuery({
    queryKey: ["ts-backtest"],
    queryFn: getTsBacktest,
    refetchInterval: 300_000,
  });

  // Your live IBKR holdings — drives the Sell button + owned-qty prefill.
  const { data: positions = [] } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 15_000,
    retry: false,
  });
  const ownedBySym = new Map(positions.filter((p) => p.quantity > 0).map((p) => [p.symbol, p.quantity]));
  const posBySym = new Map(positions.filter((p) => p.quantity > 0).map((p) => [p.symbol, p]));

  // Quick-trade popup state (Buy/Sell straight from an alert card).
  const [trade, setTrade] = useState<{ symbol: string; side: "BUY" | "SELL"; defaults?: QuickTradeDefaults } | null>(null);
  const openBuy = (a: TsAlert) =>
    setTrade({ symbol: a.symbol, side: "BUY", defaults: { price: a.entry, stop: bracketStop(a) || undefined, takeProfit: a.target } });
  const openSell = (sym: string) => setTrade({ symbol: sym, side: "SELL" });

  const quoteBySym = new Map((quotesData?.quotes ?? []).map((q) => [q.symbol, q]));
  const nowPrice = (sym: string) => quoteBySym.get(sym)?.price;

  // Inverse-ETF quotes come from IBKR (the TradeScope feed doesn't carry them).
  const { data: etfQuotes = [] } = useQuery({
    queryKey: ["inverse-etf-quotes"],
    queryFn: () => getQuotes(INVERSE_ETFS.map((e) => e.symbol)),
    refetchInterval: 5_000,
    retry: false,
  });
  const etfBySym = new Map(etfQuotes.map((q) => [q.symbol, q]));

  // Real-time IBKR prices for EVERY symbol we render — held positions, every
  // alert, and the best trade. The free TradeScope/Yahoo feed periodically
  // FREEZES mid-session (all symbols stall for 20-30 min) which leaves every
  // card stuck on an old price; even when fresh it lags a few minutes and its
  // P&L is a separate cached snapshot (a held card once showed "Now 171.63"
  // beside "-$303" while the stock was really 174+). IBKR's snapshot is the
  // real, tradeable price and stays live through Yahoo outages — so we pull it
  // for the whole page and recompute held P&L from the SAME number.
  // Sorted so the query key is stable when the SAME symbols re-appear in a
  // different order on a rescan (avoids needless cold refetches).
  const displaySyms = [...new Set([
    ...positions.filter((p) => p.quantity > 0).map((p) => p.symbol),
    ...(data?.alerts ?? []).map((a) => a.symbol).filter(Boolean),
    ...(data?.bestTrade?.symbol ? [data.bestTrade.symbol] : []),
  ])].sort();
  const { data: ibkrQuotes = [] } = useQuery({
    queryKey: ["ibkr-live-quotes", displaySyms.join(",")],
    queryFn: () => getQuotes(displaySyms),
    enabled: displaySyms.length > 0,
    refetchInterval: 3_000,
    retry: false,
  });
  // Persistent last-known IBKR price per symbol. The brokerage session flaps
  // (snapshot 500s for a beat) and the query key changes every ~20s as alerts
  // rescan — either one blanks ibkrQuotes momentarily, and WITHOUT persistence
  // the cards snapped back to the stale Yahoo price ("jumped to old data").
  // Merge each fresh price in; never drop a known one, so a card holds its last
  // real IBKR price through the gap instead of reverting.
  const ibkrPxRef = useRef<Map<string, number>>(new Map());
  for (const q of ibkrQuotes) {
    if ((q.last ?? 0) > 0) ibkrPxRef.current.set(q.symbol, q.last as number);
  }
  const ibkrPxBySym = ibkrPxRef.current;

  // Best "current price" for a symbol, session-aware:
  //  - REGULAR hours: IBKR's real-time last is the fresh, tradeable truth.
  //  - PRE/POST (extended) hours: IBKR's LAST-TRADE goes stale in the thin
  //    after-hours book (few trades → an old print stays "last"), so it reads
  //    LOWER than the price everyone sees on Yahoo/etc. The TradeScope pre/post
  //    price tracks the consolidated tape, so prefer it there.
  // Falls back across sources so a card always has a number.
  const livePrice = (sym: string) => {
    const tsq = quoteBySym.get(sym);
    const extended = tsq?.session === "PRE" || tsq?.session === "POST";
    const ibkr = ibkrPxBySym.get(sym);
    return extended ? (tsq?.price ?? ibkr) : (ibkr ?? tsq?.price);
  };

  // A held position with P&L recomputed from the live price, so a card's "Now"
  // and its P&L can never contradict each other (both come from one number).
  const livePos = (sym: string): Position | undefined => {
    const pos = posBySym.get(sym);
    if (!pos) return undefined;
    const live = livePrice(sym);
    if (!live || live <= 0 || !(pos.entryPrice > 0)) return pos;
    return {
      ...pos,
      currentPrice: live,
      pnl: (live - pos.entryPrice) * pos.quantity,
      pnlPct: ((live - pos.entryPrice) / pos.entryPrice) * 100,
    };
  };

  // Same silent quality-gate as buy alerts: a short play only appears while it
  // is genuinely WORKING — the inverse ETF is up ≥0.2% AND above today's open
  // (its index is actually falling). Nothing strong → the whole section hides.
  // EXCEPTION: an ETF you actually HOLD stays visible until you sell it.
  const strongEtfs = [...INVERSE_ETFS]
    .map((e) => {
      const q = etfBySym.get(e.symbol);
      const anchor = q?.open || q?.prevClose || 0;
      const strong = !!q && q.last > 0 && (q.changePct ?? 0) >= 0.2 && anchor > 0 && q.last >= anchor;
      return { ...e, q, strong, owned: ownedBySym.get(e.symbol) ?? 0 };
    })
    .filter((x) => x.strong || x.owned > 0)
    .sort((a, b) => (b.q?.changePct ?? 0) - (a.q?.changePct ?? 0));

  const INDEX_SYMS = ["SPY", "QQQ", "DIA", "IWM"];
  const indices = (quotesData?.quotes ?? []).filter((q) => INDEX_SYMS.includes(q.symbol));

  // Market direction from the major indices — used to surface downside plays.
  const indexAvg = indices.length ? indices.reduce((a, q) => a + (q.changePct || 0), 0) / indices.length : 0;
  const marketDown = indices.length > 0 && indexAvg < -0.05;

  // Defensive locals + validity: only keep alerts/best-trade with real levels
  // (the engine occasionally emits an empty best-trade → "Score NaN / $0.00").
  const valid = (a?: TsAlert | null): a is TsAlert =>
    !!a && !!a.symbol && Number(a.entry) > 0 && Number.isFinite(Number(a.score));

  // QUALITY GATE (silent): a setup only ever appears while it is WORKING —
  // live price at/above entry, or at most a hair below (<15% of the way to the
  // stop). Anything already sliding never shows up at all; no "hidden" notice,
  // no padding to a fixed count. Re-checked every second.
  const working = (a: TsAlert): boolean => {
    const now = nowPrice(a.symbol);
    if (now == null || now <= 0) return true;
    if (now >= a.entry) return true; // at/above entry — heading to target
    const span = a.entry - a.stop;
    if (span <= 0) return true;
    return (a.entry - now) / span < 0.15;
  };

  // HOLDING override: once you actually own a symbol, its card NEVER hides —
  // not by the sliding gate, not by target/stop — until the position is sold.
  const holding = (sym: string) => (ownedBySym.get(sym) ?? 0) > 0;

  const alerts = (data?.alerts ?? [])
    .filter(valid)
    .filter((a) => working(a) || holding(a.symbol))
    // Strongest first: in-profit distance toward target, then score.
    .sort((x, y) => {
      const px = ((nowPrice(x.symbol) ?? x.entry) - x.entry) / x.entry;
      const py = ((nowPrice(y.symbol) ?? y.entry) - y.entry) / y.entry;
      return py - px || y.score - x.score;
    });

  // The engine may have CLOSED the alert (target/stop hit) while you still hold
  // the shares — resurrect the latest closed card per held symbol so the levels
  // stay on screen until you sell.
  const liveSyms = new Set(alerts.map((a) => a.symbol));
  const heldClosed = Object.values(
    (data?.closed ?? [])
      .filter(valid)
      .filter((c) => holding(c.symbol) && !liveSyms.has(c.symbol))
      .reduce<Record<string, TsAlert>>((acc, c) => {
        const prev = acc[c.symbol];
        if (!prev || new Date(c.closedAt ?? 0) > new Date(prev.closedAt ?? 0)) acc[c.symbol] = c;
        return acc;
      }, {})
  );

  // GUARANTEE: any live stock position ALWAYS has a card here, even when the
  // engine has no alert data for it (closed[] only keeps the last few and is
  // wiped on engine restarts — that must never hide a real position).
  const cardSyms = new Set([...alerts.map((a) => a.symbol), ...heldClosed.map((a) => a.symbol)]);
  const bareHoldings = positions.filter(
    (p) =>
      p.quantity > 0 &&
      p.assetClass === "STK" &&
      !cardSyms.has(p.symbol) &&
      !INVERSE_ETFS.some((e) => e.symbol === p.symbol)
  );

  const rawBest = data?.bestTrade;
  // Best Trade must pass the same gate; otherwise promote the top working alert.
  const bestTrade = valid(rawBest) && working(rawBest) ? rawBest : (alerts[0] ?? null);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Bell className="h-5 w-5 text-info" /> AI Stock Alerts
          </h1>
          <p className="text-sm text-muted-foreground">
            Live stock buy setups — entry, target and stop for each. Re-scanned every ~10 min.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${data.marketOpen ? "bg-bull/15 text-bull" : "bg-surface-2 text-muted-foreground"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${data.marketOpen ? "bg-bull animate-pulse" : "bg-muted-foreground"}`} />
              {data.marketOpen ? "Market Open" : "Market Closed"}
            </span>
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {timeAgo(data.updated)} · {data.scanned} scanned
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="rounded-2xl glass p-10 text-center text-sm">
          <AlertTriangle className="h-6 w-6 text-warn mx-auto mb-3" />
          <div className="font-semibold mb-1">Could not load alerts</div>
          <div className="text-muted-foreground text-xs">{(error as Error)?.message}</div>
        </div>
      ) : (
        <>
          {/* ---- Best Trade (only when valid) ---- */}
          {bestTrade && (
            <BestTrade
              a={bestTrade}
              now={livePrice(bestTrade.symbol)}
              owned={ownedBySym.get(bestTrade.symbol) ?? 0}
              pos={livePos(bestTrade.symbol)}
              onBuy={() => openBuy(bestTrade)}
              onSell={() => openSell(bestTrade.symbol)}
            />
          )}

          {/* ---- Short-side plays — ONLY while genuinely strong, else hidden ---- */}
          {strongEtfs.length > 0 && (
          <section className="rounded-2xl glass p-5 border border-bear/30">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-bear" />
              <h2 className="text-sm font-semibold">
                {strongEtfs.some((e) => e.strong)
                  ? <>Market falling{marketDown ? ` (${indexAvg.toFixed(2)}%)` : ""} — {strongEtfs.filter((e) => e.strong).length} SHORT play{strongEtfs.filter((e) => e.strong).length > 1 ? "s" : ""} working</>
                  : <>Your short-side holdings</>}
              </h2>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 mb-3">
              These go UP when the market falls — buying one = betting the market DOWN (all IBKR-tradable).
              3x versions move faster and are riskier.
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {strongEtfs
                .map((e) => {
                  const q = e.q;
                  const now = q?.last || nowPrice(e.symbol) || 0;
                  const chg = q?.changePct;
                  const active = e.strong;
                  const owned = e.owned;
                  // Play levels anchored to today's open: target +3%, stop -2% —
                  // the same defaults the trade popup suggests.
                  const base = q?.open || q?.prevClose || now;
                  const entry = base > 0 ? +base.toFixed(2) : 0;
                  const target = entry > 0 ? +(entry * 1.03).toFixed(2) : 0;
                  const stopL = entry > 0 ? +(entry * 0.98).toFixed(2) : 0;
                  return (
                    <div key={e.symbol} className={`rounded-2xl p-4 flex flex-col gap-3 ${active ? "glass border border-bull/25" : "glass"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link to="/stock/$symbol" params={{ symbol: e.symbol }} className="text-lg font-bold hover:text-primary transition" title="Open chart">
                            {e.symbol}
                          </Link>
                          {active && <span className="rounded bg-bull/15 text-bull text-[9px] font-bold px-1.5 py-0.5">ACTIVE</span>}
                          {owned > 0 && <span className="rounded bg-info/15 text-info text-[9px] font-bold px-1.5 py-0.5">HOLDING {owned}</span>}
                        </div>
                        {chg != null && (
                          <span className={`text-xs num font-semibold ${chg >= 0 ? "text-bull" : "text-bear"}`}>{pct(chg)}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground -mt-2">{e.name}</div>

                      {entry > 0 ? (
                        <>
                          <div className="flex gap-2">
                            <Level label="Entry" value={entry} tone="info" />
                            <Level label="Target" value={target} sub="+3.00%" tone="bull" />
                            <Level label="Stop" value={stopL} sub="-2.00%" tone="bear" />
                          </div>
                          <LevelBar entry={entry} target={target} stop={stopL} now={now || undefined} />
                          <YourPosition pos={livePos(e.symbol)} />
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>Bearish play · rises when the market falls</span>
                            {now > 0 && <span className="num">Now {money(now)}</span>}
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px] text-muted-foreground py-2">Log in to IBKR for live levels.</div>
                      )}

                      <div className="flex gap-2 mt-auto">
                        <button
                          onClick={() => setTrade({ symbol: e.symbol, side: "BUY", defaults: now > 0 ? { price: now, stop: +(now * 0.98).toFixed(2), takeProfit: +(now * 1.03).toFixed(2) } : undefined })}
                          className="flex-1 h-9 rounded-lg bg-bull glow-bull text-background text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition"
                        >
                          <ArrowUpRight className="h-4 w-4" /> Buy
                        </button>
                        {owned > 0 && (
                          <button
                            onClick={() => openSell(e.symbol)}
                            className="flex-1 h-9 rounded-lg bg-bear glow-bear text-background text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition"
                          >
                            <ArrowDownRight className="h-4 w-4" /> Sell {owned}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
          )}

          {/* ---- Buy Alerts ---- */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold">Buy Alerts</h2>
              <span className="text-[11px] text-muted-foreground">
                {alerts.length} working{(heldClosed.length + bareHoldings.length) > 0 && <> · {heldClosed.length + bareHoldings.length} holding</>}
              </span>
            </div>
            {alerts.length === 0 && heldClosed.length === 0 && bareHoldings.length === 0 ? (
              <div className="rounded-2xl glass p-8 text-center text-muted-foreground text-sm">
                No strong setups right now. Quality over quantity — new ones appear as soon as they qualify.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[...alerts, ...heldClosed].map((a) => (
                  <AlertCard
                    key={a.id}
                    a={a}
                    now={livePrice(a.symbol)}
                    owned={ownedBySym.get(a.symbol) ?? 0}
                    pos={livePos(a.symbol)}
                    onBuy={() => openBuy(a)}
                    onSell={() => openSell(a.symbol)}
                  />
                ))}
                {bareHoldings.map((p) => (
                  <HoldingCard
                    key={p.conid}
                    p={p}
                    now={livePrice(p.symbol)}
                    onBuy={() => setTrade({ symbol: p.symbol, side: "BUY" })}
                    onSell={() => openSell(p.symbol)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ---- Market Mood (indices only — the full quote wall was noise) ---- */}
          <section className="rounded-2xl glass p-5">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Gauge className="h-4 w-4 text-violet" /> Market Mood</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {indices.map((q) => (
                <Link
                  key={q.symbol}
                  to="/stock/$symbol"
                  params={{ symbol: q.symbol }}
                  title="Open chart"
                  className="flex items-center justify-between rounded-lg hairline bg-surface-1 px-3 py-2 transition hover:ring-1 hover:ring-primary/40"
                >
                  <div className="text-xs">
                    <div className="font-semibold">{q.symbol}</div>
                    <div className="text-[10px] text-muted-foreground">{(q.name ?? q.symbol ?? "").replace(/ · .*/, "")}</div>
                  </div>
                  <div className="text-right num">
                    <div className="text-sm font-semibold">{money(q.price)}</div>
                    <div className={`text-[11px] ${q.changePct >= 0 ? "text-bull" : "text-bear"}`}>{pct(q.changePct)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ---- Strategy Reality Check ---- */}
          {backtest && <RealityCheck b={backtest} stats={data?.stats} closed={data?.closed ?? []} />}
        </>
      )}

      {trade && (
        <QuickTradeModal
          symbol={trade.symbol}
          side={trade.side}
          ownedQty={ownedBySym.get(trade.symbol) ?? 0}
          defaults={trade.defaults}
          onClose={() => setTrade(null)}
        />
      )}
    </div>
  );
}

// Card for a live position that has NO alert data — position itself is the
// source of truth: avg cost, live price, P&L, and the Buy/Sell buttons.
function HoldingCard({ p, now, onBuy, onSell }: {
  p: { symbol: string; quantity: number; entryPrice: number; currentPrice: number; pnl: number; pnlPct: number };
  now?: number;
  onBuy: () => void;
  onSell: () => void;
}) {
  const live = now ?? p.currentPrice ?? 0;
  // Recompute P&L from the SAME live price shown as "Now" so they always agree
  // (never a stale-snapshot P&L beside a differently-stale price).
  const consistent = live > 0 && p.entryPrice > 0;
  const pnl = consistent ? (live - p.entryPrice) * p.quantity : (p.pnl ?? 0);
  const pnlPct = consistent ? ((live - p.entryPrice) / p.entryPrice) * 100 : (p.pnlPct ?? 0);
  const up = pnl >= 0;
  return (
    <div className="rounded-2xl glass p-4 flex flex-col gap-3 border border-info/25">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/stock/$symbol" params={{ symbol: p.symbol }} className="text-lg font-bold hover:text-primary transition" title="Open chart">
            {p.symbol}
          </Link>
          <span className="rounded bg-info/15 text-info text-[9px] font-bold px-1.5 py-0.5">HOLDING {p.quantity}</span>
        </div>
        <span className={`text-xs num font-semibold ${up ? "text-bull" : "text-bear"}`}>
          {up ? "+" : ""}${fmtMoney(pnl)} ({pct(pnlPct)})
        </span>
      </div>
      <div className="flex gap-2">
        <Level label="Avg Cost" value={p.entryPrice} tone="info" />
        <Level label="Now" value={live} tone={up ? "bull" : "bear"} />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Your live IBKR position — no active alert on this symbol right now.
      </div>
      <TradeButtons owned={p.quantity} onBuy={onBuy} onSell={onSell} />
    </div>
  );
}

// Shared Buy / (Sell when holding) button pair for the alert cards.
function TradeButtons({ owned, onBuy, onSell, tall }: { owned: number; onBuy: () => void; onSell: () => void; tall?: boolean }) {
  const h = tall ? "h-10" : "h-9";
  return (
    <div className="flex gap-2 mt-auto">
      <button
        onClick={onBuy}
        className={`flex-1 ${h} rounded-lg bg-bull glow-bull text-background text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition`}
      >
        <ArrowUpRight className="h-4 w-4" /> Buy
      </button>
      {owned > 0 && (
        <button
          onClick={onSell}
          className={`flex-1 ${h} rounded-lg bg-bear glow-bear text-background text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition`}
        >
          <ArrowDownRight className="h-4 w-4" /> Sell {owned}
        </button>
      )}
    </div>
  );
}

interface TradeCardProps {
  a: TsAlert;
  now?: number;
  owned: number;
  pos?: Position;
  onBuy: () => void;
  onSell: () => void;
}

// "Your position" strip shown on any card whose symbol you actually hold:
// YOUR average cost + live P&L, alongside the engine's levels.
function YourPosition({ pos }: { pos?: Position }) {
  if (!pos) return null;
  const up = (pos.pnl ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between rounded-lg bg-info/10 border border-info/20 px-2.5 py-1.5 text-[11px]">
      <span className="text-info font-semibold">Your avg ${fmtMoney(pos.entryPrice)}</span>
      <span className={`num font-semibold ${up ? "text-bull" : "text-bear"}`}>
        {up ? "+" : ""}${fmtMoney(pos.pnl ?? 0)} ({pct(pos.pnlPct)})
      </span>
    </div>
  );
}

function BestTrade({ a, now, owned, pos, onBuy, onSell }: TradeCardProps) {
  return (
    <div className="rounded-2xl glass p-5 relative overflow-hidden">
      <div className="absolute -top-16 -right-10 h-48 w-48 rounded-full bg-bull/10 blur-3xl" />
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-warn" />
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-warn">Best Trade of the Moment</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Link to="/stock/$symbol" params={{ symbol: a.symbol }} className="text-2xl font-bold hover:text-primary transition" title="Open chart">
              {a.symbol}
            </Link>
            <span className="rounded-md bg-primary/15 text-primary text-[11px] font-bold px-2 py-0.5">Score {Math.round(a.score)}</span>
            {owned > 0 && <span className="rounded-md bg-info/15 text-info text-[11px] font-bold px-2 py-0.5">HOLDING {owned}</span>}
            <span className="text-[11px] text-muted-foreground">{a.timeframe}</span>
            {now != null && <span className="text-sm num text-muted-foreground">Now {money(now)}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(a.reasons ?? []).slice(0, 4).map((r, i) => (
              <span key={i} className="text-[11px] rounded-md bg-surface-2 px-2 py-0.5 text-muted-foreground">{r}</span>
            ))}
          </div>
          {a.news?.headline && (
            <div className="mt-3 flex items-start gap-2 text-xs">
              <Newspaper className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold mr-1.5 ${sentimentColor(a.news.sentiment)}`}>{a.news.sentiment}</span>
                <span className="text-muted-foreground">{a.news.headline}</span>
                <span className="text-[10px] text-muted-foreground/70"> · {a.news.source}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-3 w-full sm:w-auto sm:min-w-[280px]">
          <div className="flex gap-2">
            <Level label="Entry" value={a.entry} tone="info" />
            <Level label="Target" value={a.target} sub={pct(a.targetPct)} tone="bull" />
            <Level label="Stop" value={a.stop} sub={pct(a.stopPct)} tone="bear" />
          </div>
          <LevelBar entry={a.entry} target={a.target} stop={a.stop} now={now} />
          <YourPosition pos={pos} />
          <TradeButtons owned={owned} onBuy={onBuy} onSell={onSell} tall />
        </div>
      </div>
    </div>
  );
}

function AlertCard({ a, now, owned, pos, onBuy, onSell }: TradeCardProps) {
  return (
    <div className="rounded-2xl glass p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/stock/$symbol" params={{ symbol: a.symbol }} className="text-lg font-bold hover:text-primary transition" title="Open chart">
            {a.symbol}
          </Link>
          {owned > 0 && <span className="rounded bg-info/15 text-info text-[9px] font-bold px-1.5 py-0.5">HOLDING {owned}</span>}
          <span className="text-[10px] text-muted-foreground">{a.timeframe}</span>
        </div>
        <span className="rounded-md bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.5">Score {Math.round(a.score)}</span>
      </div>

      <div className="flex gap-2">
        <Level label="Entry" value={a.entry} tone="info" />
        <Level label="Target" value={a.target} sub={pct(a.targetPct)} tone="bull" />
        <Level label="Stop" value={a.stop} sub={pct(a.stopPct)} tone="bear" />
      </div>

      <LevelBar entry={a.entry} target={a.target} stop={a.stop} now={now} />

      <YourPosition pos={pos} />

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>R/R {a.riskReward?.toFixed(1)} · RSI {Math.round(a.rsi)} · Vol {a.relVol?.toFixed(1)}x</span>
        {now != null && <span className="num">Now {money(now)}</span>}
      </div>

      {a.reasons?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {a.reasons.slice(0, 3).map((r, i) => (
            <span key={i} className="text-[10px] rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground">{r}</span>
          ))}
        </div>
      )}

      {a.news?.headline && (
        <div className="flex items-start gap-1.5 text-[11px]">
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0 ${sentimentColor(a.news.sentiment)}`}>{a.news.sentiment}</span>
          <span className="text-muted-foreground line-clamp-2">{a.news.headline}</span>
        </div>
      )}

      <TradeButtons owned={owned} onBuy={onBuy} onSell={onSell} />
    </div>
  );
}

function RealityCheck({ b, stats, closed }: { b: TsBacktest; stats?: { wins: number; losses: number; scratches: number }; closed: TsAlert[] }) {
  const cells = [
    { k: "Win Rate", v: `${b.winRate?.toFixed(1)}%`, c: "text-info" },
    { k: "Profit Factor", v: b.profitFactor?.toFixed(2), c: b.profitFactor >= 1 ? "text-bull" : "text-bear" },
    { k: "Avg Win", v: `${b.avgWinR?.toFixed(2)}R`, c: "text-bull" },
    { k: "Avg Loss", v: `${b.avgLossR?.toFixed(2)}R`, c: "text-bear" },
    { k: "Total Return", v: pct(b.totalReturnPct), c: b.totalReturnPct >= 0 ? "text-bull" : "text-bear" },
    { k: "Max Drawdown", v: `-${b.maxDrawdownPct?.toFixed(1)}%`, c: "text-bear" },
    { k: "Max Consec Losses", v: String(b.maxConsecLosses), c: "text-warn" },
    { k: "Backtest Trades", v: String(b.trades), c: "text-muted-foreground" },
  ];
  return (
    <section className="rounded-2xl glass p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold flex items-center gap-2"><Gauge className="h-4 w-4 text-warn" /> Strategy Reality Check</div>
        {stats && <div className="text-[11px] text-muted-foreground">Today: <span className="text-bull">{stats.wins}W</span> · <span className="text-bear">{stats.losses}L</span> · {stats.scratches} scratch</div>}
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">Honest, backtested on {b.symbols} symbols over {b.trades} trades. Risk {b.riskPerTrade}% per trade. Past performance ≠ future results.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {cells.map((c) => (
          <div key={c.k} className="rounded-lg hairline bg-surface-1 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.k}</div>
            <div className={`text-lg font-bold num mt-1 ${c.c}`}>{c.v}</div>
          </div>
        ))}
      </div>

      {closed.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Recently Closed</div>
          <div className="space-y-1.5">
            {closed.slice(0, 6).map((c) => {
              const win = (c.resultPct ?? 0) >= 0;
              return (
                <div key={c.id} className="flex items-center justify-between rounded-lg hairline bg-surface-1 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">{c.status}</span>
                  </div>
                  <div className="flex items-center gap-3 num">
                    <span className="text-muted-foreground">{money(c.entry)} → {money(c.closePrice ?? 0)}</span>
                    <span className={`font-semibold ${win ? "text-bull" : "text-bear"}`}>{pct(c.resultPct ?? 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
