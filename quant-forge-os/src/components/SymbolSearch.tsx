import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Command, TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { CONIDS, getMarketSnapshot } from "@/lib/api/ibkr";
import { fmtMoney } from "@/lib/market-data";
import { Delta } from "./Delta";

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

export function SymbolSearch() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter symbols based on query
  const filteredSymbols = query.length > 0 
    ? SYMBOLS.filter(s => 
        s.symbol.toLowerCase().includes(query.toLowerCase()) ||
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.sector.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 15) // Limit search results to 15
    : isOpen ? SYMBOLS : []; // Show ALL symbols when clicked without input

  // Get market data for filtered symbols (limit API calls for performance)
  const symbolConids = filteredSymbols.slice(0, 20).map(s => s.conid); // Limit to first 20 for API performance
  const { data: quotes = [] } = useQuery({
    queryKey: ["search-quotes", symbolConids],
    queryFn: () => symbolConids.length > 0 ? getMarketSnapshot(symbolConids) : [],
    enabled: symbolConids.length > 0 && isOpen,
    refetchInterval: 3000, // Slower refresh for search to reduce API load
  });

  // Enrich symbols with market data (only for symbols we have quotes for)
  const enrichedSymbols = filteredSymbols.map(symbol => {
    const quote = quotes.find(q => q.conid === symbol.conid);
    return {
      ...symbol,
      price: quote?.last || 0,
      changePct: quote?.changePct || 0,
      hasMarketData: !!quote, // Track which symbols have live data
    };
  });

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || filteredSymbols.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, filteredSymbols.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredSymbols[selectedIndex]) {
            handleSelect(filteredSymbols[selectedIndex].symbol);
          }
          break;
        case "Escape":
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredSymbols, selectedIndex]);

  // Handle Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (symbol: string) => {
    navigate({ to: `/stock/${symbol}` });
    setQuery("");
    setIsOpen(false);
    setSelectedIndex(0);
    inputRef.current?.blur();
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    setIsOpen(true); // Always open when typing
    setSelectedIndex(0);
  };

  const handleInputFocus = () => {
    setIsOpen(true); // Always open on focus, even without query
    setSelectedIndex(0);
  };

  return (
    <div className="relative flex-1 max-w-xl mx-auto" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleInputFocus}
          placeholder="Search symbols, news, indicators…"
          className="w-full h-9 pl-9 pr-16 rounded-lg bg-surface-1 hairline text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground hairline">
          <Command className="h-3 w-3" /> K
        </kbd>
      </div>

      {/* Dropdown Results */}
      {isOpen && filteredSymbols.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-surface-1 rounded-xl hairline shadow-2xl z-50 overflow-hidden">
          <div className="p-2 text-xs text-muted-foreground hairline-b bg-surface-2">
            {query.length > 0 
              ? `${filteredSymbols.length} symbol${filteredSymbols.length !== 1 ? 's' : ''} found`
              : `All ${filteredSymbols.length} available symbols`
            }
          </div>
          <div className="max-h-96 overflow-y-auto">
            {enrichedSymbols.map((symbol, index) => {
              const isSelected = index === selectedIndex;
              const up = symbol.changePct >= 0;
              
              return (
                <button
                  key={symbol.symbol}
                  onClick={() => handleSelect(symbol.symbol)}
                  className={`w-full flex items-center justify-between p-3 text-left transition hover:bg-surface-2 ${
                    isSelected ? "bg-surface-2" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-8 w-8 rounded-md bg-surface-2 hairline grid place-items-center text-[10px] font-bold">
                      {symbol.symbol.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{symbol.symbol}</span>
                        <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-surface-3">
                          {symbol.sector}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{symbol.name}</div>
                    </div>
                  </div>
                  
                  {symbol.hasMarketData && symbol.price > 0 && (
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <div className="text-sm font-semibold num">${fmtMoney(symbol.price)}</div>
                        <Delta value={symbol.changePct} />
                      </div>
                      {up ? (
                        <TrendingUp className="h-4 w-4 text-bull" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-bear" />
                      )}
                    </div>
                  )}
                  
                  {!symbol.hasMarketData && (
                    <div className="text-xs text-muted-foreground">
                      Click to view
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          
          <div className="p-2 text-xs text-muted-foreground hairline-t bg-surface-2 flex items-center justify-between">
            <span>{query.length > 0 ? "Use ↑↓ to navigate, Enter to select" : "Click any symbol or start typing to search"}</span>
            <span className="text-primary">ESC to close</span>
          </div>
        </div>
      )}

      {/* No Results */}
      {isOpen && query.length > 0 && filteredSymbols.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-surface-1 rounded-xl hairline shadow-2xl z-50 p-6 text-center">
          <div className="text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm font-medium mb-1">No symbols found</div>
            <div className="text-xs">Try searching for a different symbol or company name</div>
          </div>
        </div>
      )}
    </div>
  );
}