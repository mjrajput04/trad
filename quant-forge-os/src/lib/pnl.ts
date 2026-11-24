// Round-trip P&L from raw executions.
//
// Lifted out of the Analysis page so the per-broker view and the combined view
// cannot drift apart. Two pages each carrying their own copy of this is two
// pages that eventually disagree about the same account, and a trader who has
// to work out which one to believe.

import type { Trade } from "./api/broker";

// Trading days are US/Eastern days — an 11pm ET fill must NOT roll into the
// next day just because the viewer is in IST.
export const dayKey = (t: number): string =>
  new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD

export const dayLabel = (t: number): string =>
  new Date(t).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "America/New_York" });

export interface SymbolPnl {
  symbol: string;
  realized: number;
  qtyClosed: number;
  trips: number;
  wins: number;
  losses: number;
  /**
   * Signed quantity still open at the end of the walk. It should equal the
   * position the broker actually reports; where it does not, fills are missing
   * from the front of the history and every figure for that symbol is wrong.
   * See `leftovers` on the result.
   */
  leftover: number;
}

export interface Realized {
  symbols: SymbolPnl[];
  daily: Array<{ label: string; pnl: number }>;
  wins: number;
  losses: number;
  byDayKey: Map<string, number>;
  total: number;
  /**
   * Where the walk thinks each symbol ended up, including symbols that closed
   * flat and so carry no trips. Compare it against the broker's own positions:
   * a disagreement means the fill history given to this function did not reach
   * back far enough, and the realized figures are not to be trusted.
   *
   * This is not hypothetical. E*TRADE's order endpoint caps a page at 100, and
   * once an account passed 104 orders the four oldest dropped off — the four
   * that opened an NVDA short. Every later NVDA fill was then matched against a
   * long 200 that had never existed, inventing $983 of loss and showing a
   * +$803 day as -$180. Nothing on screen suggested the number was unsafe.
   */
  leftovers: Map<string, number>;
}

/**
 * Round-trip matcher over the raw executions. Only quantity that was BOTH
 * opened and closed inside the data given counts — no guessed cost basis. Each
 * closing fill becomes one "trip" with its realized P&L, attributed to the day
 * it closed.
 */
export function computeRealized(trades: Trade[]): Realized {
  const bySym = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.symbol || !t.quantity || !t.price) continue;
    if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
    bySym.get(t.symbol)!.push(t);
  }

  const symbols: SymbolPnl[] = [];
  const leftovers = new Map<string, number>();
  const byDay = new Map<string, { t: number; pnl: number }>();
  let wins = 0;
  let losses = 0;

  for (const [symbol, fills] of bySym) {
    fills.sort((a, b) => a.time - b.time);
    // Realized against the position's AVERAGE cost — the way IBKR reports it.
    //
    // This used to match fills first-in-first-out. Over a whole round trip FIFO
    // and average cost come to the SAME total, but they split it across days
    // very differently, and this page is read next to the broker. QCOM, Nov
    // 2026: six buys from 164.43 to 177.52, then IBKR force-sold 81 shares on
    // the 4th and the rest went out at 172 on the 9th.
    //
    //            FIFO (what this page said)   average cost (what IBKR says)
    //   Nov 4            -549.02                        +18.13
    //   Nov 9          +1,339.89                       +772.73
    //   total            +790.86                       +790.87
    //
    // FIFO paired the forced sale with the oldest, dearest lots, booked the
    // loss on the 4th, and left today reading +1,339 beside a broker screen
    // saying +780. Same money, wrong day — so follow the broker.
    //
    // qty is signed: + long, - short. avg is the cost of whatever is open.
    let qty = 0;
    let avg = 0;
    const s: SymbolPnl = { symbol, realized: 0, qtyClosed: 0, trips: 0, wins: 0, losses: 0, leftover: 0 };

    for (const f of fills) {
      const dir = f.side === "BUY" ? 1 : -1;
      const n = f.quantity;
      let fillPnl = 0;
      let closed = 0;

      if (qty !== 0 && Math.sign(qty) !== dir) {
        closed = Math.min(n, Math.abs(qty));
        // A long closed by a sell earns (sell - avg); a short covered by a buy
        // earns (avg - buy). The sign of the position does both at once.
        fillPnl = (f.price - avg) * closed * Math.sign(qty);
        s.realized += fillPnl;
        s.qtyClosed += closed;
      }

      const held = Math.abs(qty);
      const opening = n - closed; // the part of this fill that closes nothing
      qty += dir * n;

      if (closed === 0) {
        // Adding to the position (or starting one): blend this fill in.
        avg = held + n > 0 ? (avg * held + f.price * n) / (held + n) : f.price;
      } else if (opening > 0) {
        // The position flipped; what is left over is a new one at this price.
        avg = f.price;
      } else if (qty === 0) {
        avg = 0;
      }
      // A partial close leaves `avg` alone — that is the whole point.

      if (closed > 0) {
        s.trips += 1;
        if (fillPnl >= 0) {
          s.wins += 1;
          wins += 1;
        } else {
          s.losses += 1;
          losses += 1;
        }
        const k = dayKey(f.time);
        const cur = byDay.get(k) ?? { t: f.time, pnl: 0 };
        cur.pnl += fillPnl;
        byDay.set(k, cur);
      }
    }
    // Every symbol, not just the ones with trips: a symbol that only ever
    // opened still has to agree with the broker.
    s.leftover = qty;
    leftovers.set(symbol, qty);
    if (s.trips > 0) symbols.push(s);
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ label: dayLabel(v.t), pnl: Number(v.pnl.toFixed(2)) }));
  symbols.sort((a, b) => b.realized - a.realized);
  // realized P&L per calendar day, keyed by YYYY-MM-DD (for "today" views)
  const byDayKey = new Map([...byDay.entries()].map(([k, v]) => [k, v.pnl]));

  return {
    symbols,
    daily,
    wins,
    losses,
    byDayKey,
    leftovers,
    total: symbols.reduce((a, s) => a + s.realized, 0),
  };
}
