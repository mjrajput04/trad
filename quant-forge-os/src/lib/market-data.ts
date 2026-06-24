// Mock realtime market data layer. Deterministic-ish random walk so the UI
// always feels alive without a backend. Swap with IBKR/WS feed later.

export type Quote = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  marketCap: number;
  spark: number[];
};

const SEED = [
  ["AAPL", "Apple Inc.", "Technology", 232.14],
  ["MSFT", "Microsoft Corp.", "Technology", 438.62],
  ["NVDA", "NVIDIA Corp.", "Semiconductors", 142.88],
  ["GOOGL", "Alphabet Inc.", "Communication", 178.45],
  ["AMZN", "Amazon.com Inc.", "Consumer Discretionary", 218.93],
  ["META", "Meta Platforms", "Communication", 612.40],
  ["TSLA", "Tesla Inc.", "Consumer Discretionary", 351.78],
  ["AVGO", "Broadcom Inc.", "Semiconductors", 234.51],
  ["JPM", "JPMorgan Chase", "Financials", 248.30],
  ["V", "Visa Inc.", "Financials", 318.62],
  ["UNH", "UnitedHealth", "Healthcare", 583.10],
  ["XOM", "Exxon Mobil", "Energy", 117.85],
  ["MA", "Mastercard", "Financials", 535.20],
  ["HD", "Home Depot", "Consumer Discretionary", 412.55],
  ["PG", "Procter & Gamble", "Consumer Staples", 168.40],
  ["COST", "Costco", "Consumer Staples", 928.60],
  ["LLY", "Eli Lilly", "Healthcare", 798.20],
  ["NFLX", "Netflix", "Communication", 902.10],
  ["AMD", "Advanced Micro Devices", "Semiconductors", 132.85],
  ["CRM", "Salesforce", "Technology", 348.92],
  ["BAC", "Bank of America", "Financials", 45.62],
  ["DIS", "Walt Disney", "Communication", 112.30],
  ["INTC", "Intel Corp.", "Semiconductors", 23.81],
  ["BA", "Boeing", "Industrials", 178.20],
  ["GE", "General Electric", "Industrials", 198.65],
] as const;

function spark(base: number, n = 40, vol = 0.012): number[] {
  const out: number[] = [base];
  for (let i = 1; i < n; i++) {
    const drift = (Math.random() - 0.5) * vol * base;
    out.push(Math.max(0.01, out[i - 1] + drift));
  }
  return out;
}

function mkQuote([symbol, name, sector, price]: readonly [string, string, string, number]): Quote {
  const pct = (Math.random() - 0.45) * 6;
  const change = +(price * (pct / 100)).toFixed(2);
  return {
    symbol,
    name,
    sector,
    price,
    change,
    changePct: +pct.toFixed(2),
    volume: Math.floor(Math.random() * 80_000_000) + 4_000_000,
    marketCap: Math.floor(price * (Math.random() * 6_000_000_000 + 500_000_000)),
    spark: spark(price),
  };
}

export const QUOTES: Quote[] = SEED.map(mkQuote);

export function topMovers(kind: "gainers" | "losers" | "volume") {
  const arr = [...QUOTES];
  if (kind === "gainers") return arr.sort((a, b) => b.changePct - a.changePct).slice(0, 6);
  if (kind === "losers") return arr.sort((a, b) => a.changePct - b.changePct).slice(0, 6);
  return arr.sort((a, b) => b.volume - a.volume).slice(0, 6);
}

export const INDICES = [
  { symbol: "SPX", name: "S&P 500", price: 6018.42, changePct: 0.62 },
  { symbol: "NDX", name: "Nasdaq 100", price: 21534.18, changePct: 1.04 },
  { symbol: "DJI", name: "Dow Jones", price: 44310.55, changePct: 0.21 },
  { symbol: "RUT", name: "Russell 2000", price: 2412.88, changePct: -0.34 },
  { symbol: "VIX", name: "Volatility", price: 14.62, changePct: -3.18 },
  { symbol: "DXY", name: "Dollar Index", price: 106.84, changePct: 0.12 },
];

export const SECTORS = [
  { name: "Technology", changePct: 1.42 },
  { name: "Semiconductors", changePct: 2.18 },
  { name: "Communication", changePct: 0.86 },
  { name: "Consumer Discretionary", changePct: 0.34 },
  { name: "Financials", changePct: 0.51 },
  { name: "Healthcare", changePct: -0.22 },
  { name: "Energy", changePct: -1.18 },
  { name: "Industrials", changePct: 0.28 },
  { name: "Consumer Staples", changePct: -0.14 },
  { name: "Utilities", changePct: -0.65 },
  { name: "Real Estate", changePct: -0.48 },
  { name: "Materials", changePct: 0.62 },
];

export function fmtMoney(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtCompact(n: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}
