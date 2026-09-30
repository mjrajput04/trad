// Number formatting helpers shared across the app.
// (All market data now comes live from IBKR — see src/lib/api/ibkr.ts.)

export function fmtMoney(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCompact(n: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}
