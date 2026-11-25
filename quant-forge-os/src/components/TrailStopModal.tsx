// Put a trailing stop on a position that is already open.
//
// A trailing stop could only be attached at entry before this, as part of a
// bracket. Anything already running could be closed by hand and nothing else,
// so a position that had moved into profit had no way to keep it.
//
// The number this screen exists to show is where the stop FIRST sits. A trail
// is quoted as a percent off the current price, which says nothing about the
// entry — so a 5% trail on a position up 2% puts the first stop three percent
// BELOW what was paid, and the thing sold as protecting a profit would bank a
// loss. The widest trail that still clears breakeven is one subtraction away,
// so the screen works it out and offers it rather than leaving it as homework.

import { useState } from "react";
import { Loader2, Shield, TrendingDown, X } from "lucide-react";
import { trailPreview, type Position } from "@/lib/api/broker";
import { fmtMoney } from "@/lib/market-data";
import { brokerInfo } from "@/lib/broker";

const PRESETS = [1, 2, 3, 5];

export function TrailStopModal({
  position,
  busy,
  onConfirm,
  onClose,
}: {
  position: Position;
  busy: boolean;
  onConfirm: (trailPct: number) => void;
  onClose: () => void;
}) {
  const { symbol, quantity, entryPrice, currentPrice } = position;
  const long = quantity > 0;

  const preview0 = trailPreview(entryPrice, currentPrice, quantity, 1);
  const maxSafe = preview0.maxSafePct;
  const inProfit = maxSafe > 0;

  // Open on the widest trail that still clears breakeven, rounded down so
  // rounding can never push the stop under the entry. Nothing to clear when
  // the position is under water, so fall back to a plain 2%.
  const [pct, setPct] = useState<number>(() =>
    inProfit ? Math.max(0.1, Math.floor(maxSafe * 10) / 10) : 2,
  );

  const p = trailPreview(entryPrice, currentPrice, quantity, pct);
  const tooWide = inProfit && pct > maxSafe;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl glass hairline p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Trailing stop · {symbol}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {long ? "Long" : "Short"} {Math.abs(quantity)} · entry ${fmtMoney(entryPrice)} · now $
              {fmtMoney(currentPrice)}
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md hairline bg-surface-2 grid place-items-center">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Trail by
          </div>
          <div className="flex gap-1.5 mb-2">
            {PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setPct(v)}
                className={`flex-1 h-8 rounded-lg text-xs font-semibold transition ${
                  pct === v ? "bg-primary/20 text-primary" : "hairline bg-surface-2 hover:bg-surface-1"
                }`}
              >
                {v}%
              </button>
            ))}
          </div>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={pct}
            onChange={(e) => setPct(Math.max(0.1, Number(e.target.value) || 0.1))}
            className="w-full h-9 rounded-lg hairline bg-surface-2 px-3 num text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {inProfit && (
            <button
              onClick={() => setPct(Math.max(0.1, Math.floor(maxSafe * 10) / 10))}
              className="mt-1.5 text-[10.5px] text-primary hover:underline"
            >
              Widest trail that still locks a profit: {maxSafe.toFixed(1)}%
            </button>
          )}
        </div>

        <div
          className={`mt-3 rounded-lg px-3 py-2.5 text-[11.5px] leading-relaxed ${
            p.locksProfit ? "bg-bull/10 text-bull" : "bg-warn/10 text-warn"
          }`}
        >
          <div className="font-semibold">
            Stop starts at ${fmtMoney(p.stop)}
            {p.locksProfit
              ? ` — locks in +$${fmtMoney(p.locked)}`
              : ` — $${fmtMoney(Math.abs(p.locked))} worse than your entry`}
          </div>
          <div className="opacity-80 mt-0.5">
            {p.locksProfit
              ? `It follows the price ${long ? "up" : "down"} and never moves back, so that floor can only rise.`
              : inProfit
                ? `This trail is wider than the ${maxSafe.toFixed(1)}% you are up, so it would close at a loss. Narrow it to keep the gain.`
                : `This position is not in profit, so no trail can lock one in — this caps the loss instead.`}
          </div>
        </div>

        {tooWide && (
          <div className="mt-2 flex items-start gap-1.5 text-[10.5px] text-warn">
            <TrendingDown className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>Sent as-is this protects nothing you have gained.</span>
          </div>
        )}

        <div className="mt-4 text-[10.5px] text-muted-foreground leading-relaxed">
          Held by {brokerInfo().short}, good until cancelled — it survives this browser and the
          night. Any other working order on {symbol} is cancelled first, so one position never ends
          up with two live exits.
        </div>

        <button
          onClick={() => onConfirm(pct)}
          disabled={busy}
          className="mt-3 w-full h-10 rounded-lg bg-primary text-background text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
          {long ? "Sell" : "Buy to cover"} {Math.abs(quantity)} {symbol} on a {pct}% trail
        </button>
      </div>
    </div>
  );
}
