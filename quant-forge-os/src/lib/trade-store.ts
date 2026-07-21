// All-time trade archive. IBKR's Client Portal only exposes ~7 days of
// executions, so every time the app sees trades it UPSERTS them into our own
// Supabase table (ibkr_trades, keyed by execution_id — idempotent). History
// and Analysis then read the full archive instead of just the last week.

import { supabase } from "@/integrations/supabase/client";
import { getTrades, getOrders, type Trade } from "./api/ibkr";

// The generated Database types predate this table — keep the cast contained here.
const tradesTable = () => (supabase as any).from("ibkr_trades");

/** Archive IBKR executions (idempotent — duplicates are ignored). */
export async function syncTrades(trades: Trade[]): Promise<number> {
  const rows = trades
    .filter((t) => t.executionId && t.time > 0)
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

/** The full saved archive, newest first. */
export async function getArchivedTrades(): Promise<Trade[]> {
  const { data, error } = await tradesTable()
    .select("*")
    .order("traded_at", { ascending: false })
    .limit(10000);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    executionId: r.execution_id,
    symbol: r.symbol,
    side: r.side as Trade["side"],
    quantity: Number(r.quantity),
    price: Number(r.price),
    commission: Number(r.commission ?? 0),
    netAmount: Number(r.net_amount ?? 0),
    orderRef: r.order_ref ?? "",
    time: +new Date(r.traded_at),
  }));
}

/**
 * IBKR's /iserver/account/trades LAGS several minutes behind reality, but a
 * FILLED order shows up in /iserver/account/orders within seconds. Surface
 * filled orders as provisional executions until the real records land — a
 * provisional row shrinks/disappears as matching real executions arrive.
 */
async function getProvisionalFills(real: Trade[]): Promise<Trade[]> {
  const orders = await getOrders().catch(() => [] as any[]);
  const out: Trade[] = [];
  for (const o of orders as any[]) {
    if (o.status !== "Filled" || !(o.filled > 0)) continue;
    const t = o.timeMs || Date.now();
    // real executions already covering this order (same symbol+side, ±45 min)
    const realQty = real
      .filter((r) => r.symbol === o.symbol && r.side === o.side && Math.abs(r.time - t) < 45 * 60_000)
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
  const recent = await getTrades(7).catch(() => [] as Trade[]);
  if (recent.length) await syncTrades(recent).catch(() => 0);
  const archived = await getArchivedTrades().catch(() => [] as Trade[]);
  const seen = new Set(archived.map((t) => t.executionId));
  const merged = [...archived, ...recent.filter((t) => !seen.has(t.executionId))];
  // instant-visibility layer: filled orders IBKR hasn't reported as trades yet
  const provisional = await getProvisionalFills(merged).catch(() => [] as Trade[]);
  return [...provisional, ...merged].sort((a, b) => b.time - a.time);
}
