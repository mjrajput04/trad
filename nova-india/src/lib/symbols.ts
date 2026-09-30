// The default symbol universe shown on the dashboard, search and scanner.
// Conids are resolved live from IBKR (see resolveConids in api/ibkr.ts),
// so this list is metadata only — any other symbol still works via search.

export interface SymbolInfo {
  symbol: string;
  name: string;
  sector: string;
}

export const SYMBOL_UNIVERSE: SymbolInfo[] = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Semiconductors" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Communication" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer Disc." },
  { symbol: "META", name: "Meta Platforms", sector: "Communication" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Consumer Disc." },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Communication" },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Semiconductors" },
  { symbol: "AVGO", name: "Broadcom Inc.", sector: "Semiconductors" },
  { symbol: "INTC", name: "Intel Corp.", sector: "Semiconductors" },
  { symbol: "QCOM", name: "Qualcomm Inc.", sector: "Semiconductors" },
  { symbol: "TXN", name: "Texas Instruments", sector: "Semiconductors" },
  { symbol: "ORCL", name: "Oracle Corp.", sector: "Technology" },
  { symbol: "ADBE", name: "Adobe Inc.", sector: "Technology" },
  { symbol: "CRM", name: "Salesforce Inc.", sector: "Technology" },
  { symbol: "INTU", name: "Intuit Inc.", sector: "Technology" },
  { symbol: "IBM", name: "IBM Corp.", sector: "Technology" },
  { symbol: "ACN", name: "Accenture PLC", sector: "Technology" },
  { symbol: "CSCO", name: "Cisco Systems", sector: "Technology" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials" },
  { symbol: "V", name: "Visa Inc.", sector: "Financials" },
  { symbol: "MA", name: "Mastercard Inc.", sector: "Financials" },
  { symbol: "BAC", name: "Bank of America", sector: "Financials" },
  { symbol: "WFC", name: "Wells Fargo", sector: "Financials" },
  { symbol: "GS", name: "Goldman Sachs", sector: "Financials" },
  { symbol: "AXP", name: "American Express", sector: "Financials" },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Healthcare" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare" },
  { symbol: "PFE", name: "Pfizer Inc.", sector: "Healthcare" },
  { symbol: "ABBV", name: "AbbVie Inc.", sector: "Healthcare" },
  { symbol: "LLY", name: "Eli Lilly", sector: "Healthcare" },
  { symbol: "TMO", name: "Thermo Fisher", sector: "Healthcare" },
  { symbol: "BA", name: "Boeing Co.", sector: "Industrials" },
  { symbol: "CAT", name: "Caterpillar Inc.", sector: "Industrials" },
  { symbol: "GE", name: "General Electric", sector: "Industrials" },
  { symbol: "HON", name: "Honeywell", sector: "Industrials" },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy" },
  { symbol: "CVX", name: "Chevron Corp.", sector: "Energy" },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer Staples" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Staples" },
  { symbol: "KO", name: "Coca-Cola Co.", sector: "Consumer Staples" },
  { symbol: "PEP", name: "PepsiCo Inc.", sector: "Consumer Staples" },
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer Staples" },
  { symbol: "HD", name: "Home Depot", sector: "Consumer Disc." },
  { symbol: "DIS", name: "Walt Disney Co.", sector: "Communication" },
  { symbol: "VZ", name: "Verizon", sector: "Communication" },
  { symbol: "T", name: "AT&T Inc.", sector: "Communication" },
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities" },
  { symbol: "BABA", name: "Alibaba Group", sector: "Consumer Disc." },
];

export const UNIVERSE_SYMBOLS = SYMBOL_UNIVERSE.map((s) => s.symbol);

export function symbolInfo(symbol: string): SymbolInfo {
  return (
    SYMBOL_UNIVERSE.find((s) => s.symbol === symbol.toUpperCase()) ?? {
      symbol: symbol.toUpperCase(),
      name: symbol.toUpperCase(),
      sector: "Other",
    }
  );
}
