import { useState } from "react";
import { Search, X, Plus } from "lucide-react";
import { CONIDS } from "@/lib/api/ibkr";

interface SymbolSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (symbol: string, name: string) => void;
  selectedSymbols?: string[];
}

const SYMBOL_METADATA: Record<string, { name: string; sector: string }> = {
  AAPL: { name: "Apple Inc.", sector: "Technology" },
  MSFT: { name: "Microsoft Corp.", sector: "Technology" },
  NVDA: { name: "NVIDIA Corp.", sector: "Semiconductors" },
  GOOGL: { name: "Alphabet Inc.", sector: "Communication" },
  AMZN: { name: "Amazon.com Inc.", sector: "Consumer Disc." },
  META: { name: "Meta Platforms", sector: "Communication" },
  TSLA: { name: "Tesla Inc.", sector: "Consumer Disc." },
  JPM: { name: "JPMorgan Chase", sector: "Financials" },
  V: { name: "Visa Inc.", sector: "Financials" },
  NFLX: { name: "Netflix Inc.", sector: "Communication" },
  AMD: { name: "Advanced Micro Devices", sector: "Semiconductors" },
  INTC: { name: "Intel Corp.", sector: "Semiconductors" },
  BABA: { name: "Alibaba Group", sector: "Consumer Disc." },
  DIS: { name: "Walt Disney Co.", sector: "Communication" },
  BA: { name: "Boeing Co.", sector: "Industrials" },
  GE: { name: "General Electric", sector: "Industrials" },
  WMT: { name: "Walmart Inc.", sector: "Consumer Staples" },
  PG: { name: "Procter & Gamble", sector: "Consumer Staples" },
  JNJ: { name: "Johnson & Johnson", sector: "Healthcare" },
  HD: { name: "Home Depot", sector: "Consumer Disc." },
  CVX: { name: "Chevron Corp.", sector: "Energy" },
  LLY: { name: "Eli Lilly", sector: "Healthcare" },
  XOM: { name: "Exxon Mobil", sector: "Energy" },
  ABBV: { name: "AbbVie Inc.", sector: "Healthcare" },
  PFE: { name: "Pfizer Inc.", sector: "Healthcare" },
  KO: { name: "Coca-Cola Co.", sector: "Consumer Staples" },
  COST: { name: "Costco Wholesale", sector: "Consumer Staples" },
  ADBE: { name: "Adobe Inc.", sector: "Technology" },
  CRM: { name: "Salesforce Inc.", sector: "Technology" },
  ORCL: { name: "Oracle Corp.", sector: "Technology" },
  ACN: { name: "Accenture PLC", sector: "Technology" },
  TMO: { name: "Thermo Fisher", sector: "Healthcare" },
  VZ: { name: "Verizon", sector: "Communication" },
  CSCO: { name: "Cisco Systems", sector: "Technology" },
  PEP: { name: "PepsiCo Inc.", sector: "Consumer Staples" },
  QCOM: { name: "Qualcomm Inc.", sector: "Semiconductors" },
  TXN: { name: "Texas Instruments", sector: "Semiconductors" },
  INTU: { name: "Intuit Inc.", sector: "Technology" },
  IBM: { name: "IBM Corp.", sector: "Technology" },
  CAT: { name: "Caterpillar Inc.", sector: "Industrials" },
  GS: { name: "Goldman Sachs", sector: "Financials" },
  AXP: { name: "American Express", sector: "Financials" },
  HON: { name: "Honeywell", sector: "Industrials" },
  NEE: { name: "NextEra Energy", sector: "Utilities" },
};

const SYMBOLS = Object.entries(CONIDS)
  .filter(([symbol]) => !["SPX", "NDX", "VIX"].includes(symbol))
  .map(([symbol, conid]) => ({
    symbol,
    conid,
    name: SYMBOL_METADATA[symbol]?.name ?? symbol,
    sector: SYMBOL_METADATA[symbol]?.sector ?? "Other",
  }));

export function SymbolSelector({ isOpen, onClose, onSelect, selectedSymbols = [] }: SymbolSelectorProps) {
  const [search, setSearch] = useState("");

  if (!isOpen) return null;

  const filteredSymbols = SYMBOLS.filter(s => 
    s.symbol.toLowerCase().includes(search.toLowerCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.sector.toLowerCase().includes(search.toLowerCase())
  );

  const groupedBySection = filteredSymbols.reduce((acc, symbol) => {
    if (!acc[symbol.sector]) acc[symbol.sector] = [];
    acc[symbol.sector].push(symbol);
    return acc;
  }, {} as Record<string, typeof SYMBOLS>);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 hairline-b">
          <div>
            <h2 className="text-lg font-semibold">Add Symbols</h2>
            <p className="text-sm text-muted-foreground">Select symbols to add to your watchlist</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-2 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-6 hairline-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search symbols, companies, or sectors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 h-10 rounded-lg bg-surface-2 hairline text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Symbols List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {Object.entries(groupedBySection).map(([sector, symbols]) => (
            <div key={sector}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {sector}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {symbols.map((symbol) => {
                  const isSelected = selectedSymbols.includes(symbol.symbol);
                  return (
                    <button
                      key={symbol.symbol}
                      onClick={() => onSelect(symbol.symbol, symbol.name)}
                      disabled={isSelected}
                      className={`flex items-center justify-between p-3 rounded-lg text-left transition ${
                        isSelected 
                          ? "bg-primary/10 text-primary cursor-not-allowed" 
                          : "bg-surface-2 hover:bg-surface-3"
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-sm">{symbol.symbol}</div>
                        <div className="text-xs text-muted-foreground truncate">{symbol.name}</div>
                      </div>
                      {isSelected ? (
                        <div className="text-xs text-primary font-medium">Added</div>
                      ) : (
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}