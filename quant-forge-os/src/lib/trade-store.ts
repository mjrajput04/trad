// All-time trade archive. IBKR's Client Portal only exposes ~7 days of
// executions, so every time the app sees trades it UPSERTS them into our own
// Supabase table (ibkr_trades, keyed by execution_id — idempotent). History
// and Analysis then read the full archive instead of just the last week.

import { supabase } from "@/integrations/supabase/client";
import { activeBroker, type BrokerId } from "./broker";
import { getTrades, getOrders, type Trade } from "./api/broker";

/**
 * Ask each broker for everything it has, and let the broker layer clamp to
 * what its own source can reach — IBKR stops at a week, E*TRADE's order book
 * goes back to the first trade.
 *
 * This used to ask for 7 days flat, on the assumption that the archive held
 * the rest. Where the archive does not exist, that assumption quietly deletes
 * history: on 27 Nov the window started at the 23rd, dropping 38 fills from
 * the 18th, 19th and 20th and reporting +5,762.42 of realized profit against
 * an actual +8,974.29. Not an error, not a gap on the page — just $3,211.87
 * less than the truth, with every symbol still closing flat so even the
 * leftover check had nothing to object to.
 */
const FULL_HISTORY_DAYS = 365;
// The combined view reads BOTH brokers at once, so it cannot go through the
// facade — that one follows whichever broker is selected. Each module keeps its
// own account and session, so asking both is safe whichever one is on screen.
import * as ibkrApi from "./api/ibkr";
import * as etradeApi from "./api/etrade";

// The generated Database types predate this table — keep the cast contained here.
// Each deployed instance archives into its own table (VITE_TRADES_TABLE), so a
// second client's executions never mix with the owner's.
// One table per broker. These are different accounts at different firms, so a
// shared archive would mix two sets of executions into one P&L and one history
// — and the IBKR rows carry IBKR execution ids, which would collide on nothing
// and merge on nothing. Each deployed instance can still override its own
// table name (a second client archives into ibkr_trades_c1, for example).
const tableFor = (broker: BrokerId): string =>
  broker === "etrade"
    ? import.meta.env.VITE_ETRADE_TRADES_TABLE || "etrade_trades"
    : import.meta.env.VITE_TRADES_TABLE || "ibkr_trades";

const TRADES_TABLE = (): string => tableFor(activeBroker());

const tradesTable = () => (supabase as any).from(TRADES_TABLE());

/** Archive IBKR executions (idempotent — duplicates are ignored). */
export async function syncTrades(trades: Trade[]): Promise<number> {
  const rows = trades
    // A broker's execution feed also carries cash: transfers, journals, interest
    // and adjustments, all with no symbol and no quantity. They are not trades
    // and an archive of trades should not hold them.
    .filter((t) => t.executionId && t.time > 0 && t.symbol && t.quantity > 0 && t.price > 0)
    .map((t) => ({
      execution_id: t.executionId,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      commission: t.commission ?? 0,
      net_amount: t.netAmount ?? 0,
      order_ref: t.orderRef ?? "",
      traded_at: new Date(t.time).toISOString(),
    }));
  if (!rows.length) return 0;
  const { error } = await tradesTable().upsert(rows, {
    onConflict: "execution_id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return rows.length;
}

const rowToTrade = (r: any): Trade => ({
  executionId: r.execution_id,
  symbol: r.symbol,
  side: r.side as Trade["side"],
  quantity: Number(r.quantity),
  price: Number(r.price),
  commission: Number(r.commission ?? 0),
  netAmount: Number(r.net_amount ?? 0),
  orderRef: r.order_ref ?? "",
  time: +new Date(r.traded_at),
});

/** One named broker's saved archive, newest first. */
async function archivedFor(broker: BrokerId): Promise<Trade[]> {
  const { data, error } = await (supabase as any)
    .from(tableFor(broker))
    .select("*")
    .order("traded_at", { ascending: false })
    .limit(10000);
  if (error) throw error;
  return (data ?? []).map(rowToTrade);
}

/** The full saved archive, newest first. */
export async function getArchivedTrades(): Promise<Trade[]> {
  return archivedFor(activeBroker());
}

/**
 * IBKR's /iserver/account/trades LAGS several minutes behind reality, but a
 * FILLED order shows up in /iserver/account/orders within seconds. Surface
 * filled orders as provisional executions until the real records land — a
 * provisional row shrinks/disappears as matching real executions arrive.
 */
const etDay = (t: number) =>
  new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function getProvisionalFills(real: Trade[]): Promise<Trade[]> {
  // E*TRADE needs none of this: its executions are BUILT from the order book
  // (see getTrades there), so an order can never be ahead of its own trade.
  // Running it anyway only risks counting the same fill twice.
  if (activeBroker() === "etrade") return [];
  const orders = await getOrders().catch(() => [] as any[]);
  const today = etDay(Date.now());
  const out: Trade[] = [];
  for (const o of orders as any[]) {
    if (o.status !== "Filled" || !(o.filled > 0)) continue;
    // STRICT: only orders with a REAL execution timestamp, and only TODAY's.
    // (A missing timestamp used to default to "now", which dodged the dedup
    // window and duplicated old trades in the day's numbers.)
    const t = Number(o.timeMs) || 0;
    if (!t || etDay(t) !== today) continue;
    // real executions already covering this order: same symbol+side, same ET day
    const realQty = real
      .filter((r) => r.symbol === o.symbol && r.side === o.side && etDay(r.time) === today)
      .reduce((a, r) => a + r.quantity, 0);
    const remaining = o.filled - realQty;
    if (remaining <= 0) continue;
    const px = o.avgPrice || o.price || 0;
    if (!(px > 0)) continue;
    out.push({
      executionId: `ord-${o.orderId}`,
      symbol: o.symbol,
      side: o.side,
      quantity: remaining,
      price: px,
      time: t,
      commission: 0,
      netAmount: px * remaining,
      orderRef: "provisional",
    });
  }
  return out;
}

/**
 * Fetch IBKR's recent executions, archive them, and return the FULL history
 * (archive ∪ live ∪ provisional fills, deduped, newest first). Falls back to
 * whatever side is reachable so the page still renders.
 */
export async function getTradesAllTime(): Promise<Trade[]> {
  const recent = await getTrades(FULL_HISTORY_DAYS).catch(() => [] as Trade[]);
  if (recent.length) await syncTrades(recent).catch(() => 0);
  const archived = await getArchivedTrades().catch(() => [] as Trade[]);
  const seen = new Set(archived.map((t) => t.executionId));
  const merged = [...archived, ...recent.filter((t) => !seen.has(t.executionId))];
  // instant-visibility layer: filled orders IBKR hasn't reported as trades yet
  const provisional = await getProvisionalFills(merged).catch(() => [] as Trade[]);
  return [...provisional, ...merged].sort((a, b) => b.time - a.time);
}

// ---------------------------------------------------------------------------
// Both brokers at once
// ---------------------------------------------------------------------------

export interface BrokerHistory {
  broker: BrokerId;
  /** Archive ∪ the broker's live window, deduped by execution id, newest first. */
  trades: Trade[];
  /** The broker answered. False means no session — what is here is archive only. */
  liveOk: boolean;
  /** The archive answered. False usually means its table has not been created. */
  archiveOk: boolean;
  /** Whichever side failed, in words, for a page that must not imply a total is whole. */
  error: string | null;
}

/**
 * One named broker's full history, regardless of which broker is on screen.
 *
 * Reports what it could not reach rather than returning a short list quietly.
 * A combined total built from one broker because the other had no session is
 * not a smaller total — it is a wrong one, and the page needs to be able to
 * say so.
 */
export async function getBrokerHistory(broker: BrokerId): Promise<BrokerHistory> {
  const api = broker === "etrade" ? etradeApi : ibkrApi;
  let liveOk = true;
  let archiveOk = true;
  let error: string | null = null;

  let recent: Trade[] = [];
  try {
    recent = await api.getTrades(FULL_HISTORY_DAYS);
  } catch (e: any) {
    liveOk = false;
    error = e?.message ?? "the broker could not be reached";
  }

  if (recent.length) {
    const rows = recent
      .filter((t) => t.executionId && t.time > 0 && t.symbol && t.quantity > 0 && t.price > 0)
      .map((t) => ({
        execution_id: t.executionId,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        commission: t.commission ?? 0,
        net_amount: t.netAmount ?? 0,
        order_ref: t.orderRef ?? "",
        traded_at: new Date(t.time).toISOString(),
      }));
    if (rows.length) {
      const { error: upsertError } = await (supabase as any)
        .from(tableFor(broker))
        .upsert(rows, { onConflict: "execution_id", ignoreDuplicates: true });
      if (upsertError) archiveOk = false;
    }
  }

  let archived: Trade[] = [];
  try {
    archived = await archivedFor(broker);
  } catch (e: any) {
    archiveOk = false;
    if (!error) error = e?.message ?? "the archive could not be read";
  }

  if (!archiveOk && !error) error = "the archive could not be read";

  const seen = new Set(archived.map((t) => t.executionId));
  return {
    broker,
    trades: [...archived, ...recent.filter((t) => !seen.has(t.executionId))].sort(
      (a, b) => b.time - a.time,
    ),
    liveOk,
    archiveOk,
    error,
  };
}

/** Open positions at one named broker, or null if it could not be asked. */
export async function getBrokerPositions(broker: BrokerId) {
  const api = broker === "etrade" ? etradeApi : ibkrApi;
  try {
    return await api.getPositions();
  } catch {
    return null;
  }
}
