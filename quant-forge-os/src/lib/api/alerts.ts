// Client for the TradeScope alerts engine (Express on the VPS, port 3100).
// nginx exposes it same-origin at nassphx.com/ts-api → 127.0.0.1:3100/api,
// and vite proxies /ts-api → https://nassphx.com in dev. Same-origin means no
// CORS and no cross-domain cookie issues. Data source: Yahoo Finance + Finnhub;
// news sentiment via Claude. The engine re-scans the whole market every ~10 min.

const TS_BASE = "/ts-api";

async function ts<T>(path: string): Promise<T> {
  const res = await fetch(`${TS_BASE}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`TradeScope ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export interface AlertNews {
  sentiment: "Bullish" | "Bearish" | "Neutral" | string;
  engine: string;
  reason: string;
  score: number;
  headline: string;
  source: string;
  url: string;
  when: string;
  count: number;
}

export interface TsAlert {
  id: number;
  symbol: string;
  timeframe: string;
  score: number;
  rsi: number;
  adx: number;
  relVol: number;
  atrPct: number;
  reasons: string[];
  /** Signal entry (buy) price. */
  entry: number;
  /** Profit target (sell) price. */
  target: number;
  /** Current (possibly trailed) stop price. */
  stop: number;
  /** Original stop at signal time — the right one for a fresh bracket. */
  stop0?: number;
  targetPct: number;
  stopPct: number;
  riskReward: number;
  news?: AlertNews;
  status: string;
  openedAt: string;
  // present only on closed alerts:
  closedAt?: string;
  closePrice?: number;
  resultPct?: number;
}

export interface TsAlertsResponse {
  updated: string;
  minScore: number;
  scanned: number;
  marketOpen: boolean;
  stats: { wins: number; losses: number; scratches: number };
  bestTrade: TsAlert | null;
  alerts: TsAlert[];
  closed: TsAlert[];
}

export interface TsQuote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  live: boolean;
}

export interface TsBacktest {
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  maxConsecLosses: number;
  riskPerTrade: number;
  symbols: number;
  updated: string;
}

export interface TsIndexBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TsIndex {
  symbol: string;
  name: string;
  timeframe: string;
  price: number;
  changePct: string | number;
  series: TsIndexBar[];
}

export const getTsAlerts = () => ts<TsAlertsResponse>("/alerts");
export const getTsQuotes = () => ts<{ updated: string; quotes: TsQuote[] }>("/quotes");
export const getTsBacktest = () => ts<TsBacktest>("/backtest");
export const getTsCharts = () => ts<{ updated: string; indices: TsIndex[] }>("/charts");

/**
 * The stop to use when opening a fresh bracket from an alert. The live `stop`
 * may have trailed above entry on a winning trade, which is invalid as an
 * initial stop-loss, so prefer the original `stop0` when present.
 */
export function bracketStop(a: TsAlert): number {
  const s = a.stop0 && a.stop0 > 0 ? a.stop0 : a.stop;
  // For a long, the stop must sit below entry; guard against odd data.
  return s > 0 && s < a.entry ? s : 0;
}
