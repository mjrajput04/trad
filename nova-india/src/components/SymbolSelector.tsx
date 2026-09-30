import { useEffect, useState } from "react";
import { Search, X, Plus, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { searchSymbols } from "@/lib/api/ibkr";
import { SYMBOL_UNIVERSE } from "@/lib/symbols";

interface SymbolSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (symbol: string, name: string) => void;
  selectedSymbols?: string[];
}

export function SymbolSelector({ isOpen, onClose, onSelect, selectedSymbols = [] }: SymbolSelectorProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Live IBKR search so ANY US stock can be added, not just the universe.
  const { data: remote = [], isFetching } = useQuery({
    queryKey: ["ibkr-symbol-search", debounced],
    queryFn: () => searchSymbols(debounced),
    enabled: isOpen && debounced.length >= 2,
    staleTime: 60_000,
  });

  if (!isOpen) return null;

  const filteredSymbols = SYMBOL_UNIVERSE.filter(s =>
    s.symbol.toLowerCase().includes(search.toLowerCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.sector.toLowerCase().includes(search.toLowerCase())
  );

  const localSet = new Set(filteredSymbols.map((s) => s.symbol));
  const remoteExtra = remote
    .filter((r) => !localSet.has(r.symbol))
    .slice(0, 10)
    .map((r) => ({ symbol: r.symbol, name: r.name, sector: `IBKR Search${r.exchange ? ` · ${r.exchange}` : ""}` }));

  const groupedBySection = [...filteredSymbols, ...remoteExtra].reduce((acc, symbol) => {
    if (!acc[symbol.sector]) acc[symbol.sector] = [];
    acc[symbol.sector].push(symbol);
    return acc;
  }, {} as Record<string, { symbol: string; name: string; sector: string }[]>);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-1 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 hairline-b">
          <div>
            <h2 className="text-lg font-semibold">Add Symbols</h2>
            <p className="text-sm text-muted-foreground">Search any US stock — resolved live from IBKR</p>
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
              autoFocus
              className="w-full pl-10 pr-4 h-10 rounded-lg bg-surface-2 hairline text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
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
