// All-time trade archive. IBKR's Client Portal only exposes ~7 days of
// executions, so every time the app sees trades it UPSERTS them into our own
// Supabase table (ibkr_trades, keyed by execution_id — idempotent). History
// and Analysis then read the full archive instead of just the last week.

import { supabase } from "@/integrations/supabase/client";
import { getTrades, type Trade } from "./api/ibkr";

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
 * Fetch IBKR's recent executions, archive them, and return the FULL history
 * (archive ∪ live, deduped by execution id, newest first). Falls back to
 * whatever side is reachable so the page still renders.
 */
export async function getTradesAllTime(): Promise<Trade[]> {
  const recent = await getTrades(7).catch(() => [] as Trade[]);
  if (recent.length) await syncTrades(recent).catch(() => 0);
  const archived = await getArchivedTrades().catch(() => [] as Trade[]);
  if (!archived.length) return recent;
  const seen = new Set(archived.map((t) => t.executionId));
  return [...archived, ...recent.filter((t) => !seen.has(t.executionId))].sort(
    (a, b) => b.time - a.time
  );
}
