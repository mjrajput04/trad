import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Command, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getQuotes, searchSymbols } from "@/lib/api/ibkr";
import { SYMBOL_UNIVERSE } from "@/lib/symbols";
import { fmtMoney } from "@/lib/market-data";
import { Delta } from "./Delta";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SymbolSearch() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Local matches from the default universe
  const localMatches = query.length > 0
    ? SYMBOL_UNIVERSE.filter(s =>
        s.symbol.toLowerCase().includes(query.toLowerCase()) ||
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.sector.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 15)
    : isOpen ? SYMBOL_UNIVERSE : [];

  // Live IBKR search for anything not in the local universe
  const debouncedQuery = useDebounced(query.trim(), 400);
  const { data: remoteMatches = [], isFetching: searching } = useQuery({
    queryKey: ["ibkr-symbol-search", debouncedQuery],
    queryFn: () => searchSymbols(debouncedQuery),
    enabled: isOpen && debouncedQuery.length >= 2,
    staleTime: 60_000,
  });

  const localSymbols = new Set(localMatches.map((s) => s.symbol));
  const merged = [
    ...localMatches,
    ...remoteMatches
      .filter((r) => !localSymbols.has(r.symbol))
      .slice(0, 8)
      .map((r) => ({ symbol: r.symbol, name: r.name, sector: r.exchange || "IBKR" })),
  ];

  // Live quotes for the first visible rows
  const quoteSymbols = merged.slice(0, 20).map((s) => s.symbol);
  const { data: quotes = [] } = useQuery({
    queryKey: ["search-quotes", quoteSymbols.join(",")],
    queryFn: () => getQuotes(quoteSymbols),
    enabled: quoteSymbols.length > 0 && isOpen,
    refetchInterval: 5_000,
  });
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

  const enrichedSymbols = merged.map((symbol) => {
    const quote = quoteBySymbol.get(symbol.symbol);
    return {
      ...symbol,
      price: quote?.last || 0,
      changePct: quote?.changePct || 0,
      hasMarketData: !!quote && (quote.last ?? 0) > 0,
    };
  });

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || merged.length === 0) return;
      if (document.activeElement !== inputRef.current) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, merged.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (merged[selectedIndex]) {
            handleSelect(merged[selectedIndex].symbol);
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
  }, [isOpen, merged, selectedIndex]);

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
          placeholder="Search any US stock symbol…"
          className="w-full h-9 pl-9 pr-3 md:pr-16 rounded-lg bg-surface-1 hairline text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {/* keyboard hint is meaningless on touch devices */}
        <kbd className="hidden md:inline-flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground hairline">
          <Command className="h-3 w-3" /> K
        </kbd>
      </div>

      {/* Dropdown Results — fixed full-width sheet on phones, anchored below the input on desktop */}
      {isOpen && merged.length > 0 && (
        <div className="fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-0 sm:top-full sm:mt-2 bg-surface-1 rounded-xl hairline shadow-2xl z-50 overflow-hidden">
          <div className="p-2 text-xs text-muted-foreground hairline-b bg-surface-2 flex items-center gap-2">
            {query.length > 0
              ? `${merged.length} symbol${merged.length !== 1 ? 's' : ''} found`
              : `${merged.length} symbols`}
            {searching && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {enrichedSymbols.map((symbol, index) => {
              const isSelected = index === selectedIndex;
              const up = symbol.changePct >= 0;

              return (
                <button
                  key={symbol.symbol}
                  onClick={() => handleSelect(symbol.symbol)}
                  className={`w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left transition hover:bg-surface-2 ${
                    isSelected ? "bg-surface-2" : ""
                  }`}
                >
                  <div className="h-8 w-8 rounded-md bg-surface-2 hairline grid place-items-center text-[10px] font-bold">
                    {symbol.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm shrink-0">{symbol.symbol}</span>
                      {/* sector chip needs room — desktop only */}
                      <span className="hidden sm:inline text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-surface-3 truncate">
                        {symbol.sector}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{symbol.name}</div>
                  </div>
                  {symbol.hasMarketData && symbol.price > 0 ? (
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-semibold num whitespace-nowrap ${up ? "text-bull" : "text-bear"}`}>
                        ${fmtMoney(symbol.price)}
                      </div>
                      <Delta value={symbol.changePct} />
                    </div>
                  ) : (
                    <div className="hidden sm:block text-xs text-muted-foreground shrink-0">
                      Click to view
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="hidden md:flex p-2 text-xs text-muted-foreground hairline-t bg-surface-2 items-center justify-between">
            <span>{query.length > 0 ? "Use ↑↓ to navigate, Enter to select" : "Click any symbol or start typing to search"}</span>
            <span className="text-primary">ESC to close</span>
          </div>
        </div>
      )}

      {/* No Results */}
      {isOpen && query.length > 0 && merged.length === 0 && (
        <div className="fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-0 sm:top-full sm:mt-2 bg-surface-1 rounded-xl hairline shadow-2xl z-50 p-6 text-center">
          <div className="text-muted-foreground">
            {searching ? (
              <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
            ) : (
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            )}
            <div className="text-sm font-medium mb-1">{searching ? "Searching IBKR…" : "No symbols found"}</div>
            <div className="text-xs">Try searching for a different symbol or company name</div>
          </div>
        </div>
      )}
    </div>
  );
}
