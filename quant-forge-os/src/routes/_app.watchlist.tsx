import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { Delta } from "@/components/Delta";
import { SymbolSelector } from "@/components/SymbolSelector";
import { fmtCompact, fmtMoney } from "@/lib/market-data";
import { getQuotes, resolveConids, getChartData } from "@/lib/api/ibkr";
import { 
  getWatchlists, 
  getWatchlistWithItems, 
  createWatchlist, 
  addToWatchlist, 
  removeFromWatchlist,
  deleteWatchlist 
} from "@/lib/api/watchlist";
import { GripVertical, Plus, Star, Trash2, Loader2, Edit3 } from "lucide-react";

export const Route = createFileRoute("/_app/watchlist")({
  head: () => ({ meta: [{ title: "Watchlist · NOVA" }, { name: "description", content: "Custom realtime watchlists with sparklines and quick trade." }] }),
  component: WatchlistPage,
});

function WatchlistPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const [showSymbolSelector, setShowSymbolSelector] = useState(false);
  const [showNewWatchlistForm, setShowNewWatchlistForm] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");

  // Get all watchlists
  const { data: watchlists = [], isLoading: watchlistsLoading } = useQuery({
    queryKey: ["watchlists"],
    queryFn: getWatchlists,
  });

  // Set active watchlist to first one if none selected
  const currentWatchlistId = activeWatchlistId || watchlists[0]?.id;

  // Get active watchlist with items
  const { data: activeWatchlist, isLoading: watchlistLoading } = useQuery({
    queryKey: ["watchlist", currentWatchlistId],
    queryFn: () => currentWatchlistId ? getWatchlistWithItems(currentWatchlistId) : null,
    enabled: !!currentWatchlistId,
  });

  // Get market data for watchlist symbols (conids resolved live from IBKR)
  const watchSymbols = activeWatchlist?.items.map(item => item.symbol) || [];
  const { data: quotes = [] } = useQuery({
    queryKey: ["watchlist-quotes", watchSymbols.join(",")],
    queryFn: () => getQuotes(watchSymbols),
    enabled: watchSymbols.length > 0,
    refetchInterval: 3000,
  });

  // Get historical data for sparklines
  const { data: sparklineData = {} } = useQuery({
    queryKey: ["watchlist-sparklines", watchSymbols.join(",")],
    queryFn: async () => {
      const conidMap = await resolveConids(watchSymbols);
      const sparklines: Record<string, number[]> = {};

      // Get 1-day 5min data for each symbol to create sparklines
      for (const [symbol, conid] of Object.entries(conidMap).slice(0, 10)) {
        try {
          const chartData = await getChartData(conid, "1d", "5min");
          if (chartData.length > 0) {
            // Take last 20 data points for sparkline
            const prices = chartData.slice(-20).map((d: { c: number }) => d.c);
            sparklines[symbol] = prices.length >= 10 ? prices : [];
          }
        } catch (error) {
          console.warn(`Failed to get sparkline for ${symbol}:`, error);
        }
      }
      return sparklines;
    },
    enabled: watchSymbols.length > 0,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000, // Consider data stale after 30 seconds
  });

  // Create watchlist mutation
  const createWatchlistMutation = useMutation({
    mutationFn: createWatchlist,
    onSuccess: (newWatchlist) => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setActiveWatchlistId(newWatchlist.id);
      setShowNewWatchlistForm(false);
      setNewWatchlistName("");
    },
  });

  // Add symbol mutation
  const addSymbolMutation = useMutation({
    mutationFn: ({ symbol, name }: { symbol: string; name: string }) => 
      addToWatchlist(currentWatchlistId!, symbol, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", currentWatchlistId] });
    },
  });

  // Remove symbol mutation
  const removeSymbolMutation = useMutation({
    mutationFn: removeFromWatchlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", currentWatchlistId] });
    },
  });

  // Delete watchlist mutation
  const deleteWatchlistMutation = useMutation({
    mutationFn: deleteWatchlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setActiveWatchlistId(null);
    },
  });

  const handleCreateWatchlist = () => {
    if (newWatchlistName.trim()) {
      createWatchlistMutation.mutate(newWatchlistName.trim());
    }
  };

  const handleAddSymbol = (symbol: string, name: string) => {
    if (currentWatchlistId) {
      addSymbolMutation.mutate({ symbol, name });
    }
  };

  const selectedSymbols = activeWatchlist?.items.map(item => item.symbol) || [];

  // Enrich watchlist items with live market data (no fabricated fallbacks)
  const quoteBySymbol = new Map(quotes.map(q => [q.symbol, q]));
  const enrichedItems = activeWatchlist?.items.map(item => {
    const quote = quoteBySymbol.get(item.symbol.toUpperCase());
    return {
      ...item,
      price: quote?.last || 0,
      changePct: quote?.changePct || 0,
      volume: quote?.volume || 0,
      updated: quote?.updated || 0,
      sparkData: sparklineData[item.symbol.toUpperCase()] || [],
    };
  }) || [];

  if (watchlistsLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Watchlists</h1>
          <p className="text-sm text-muted-foreground">Realtime quotes with sparklines, alerts, and quick trade.</p>
        </div>
        <div className="flex gap-2">
          {currentWatchlistId && (
            <button 
              onClick={() => setShowSymbolSelector(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary/15 text-primary px-3 h-9 text-xs font-semibold hover:bg-primary/20 transition"
            >
              <Plus className="h-3.5 w-3.5" /> Add Symbol
            </button>
          )}
          <button 
            onClick={() => setShowNewWatchlistForm(true)}
            className="inline-flex items-center gap-2 rounded-lg gradient-primary text-background px-3 h-9 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" /> New Watchlist
          </button>
        </div>
      </div>

      {/* Watchlist Tabs */}
      {watchlists.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {watchlists.map((watchlist) => (
            <div key={watchlist.id} className="flex items-center">
              <button
                onClick={() => setActiveWatchlistId(watchlist.id)}
                className={`px-3 h-8 rounded-l-lg text-xs hairline ${currentWatchlistId === watchlist.id ? "bg-primary/15 text-foreground" : "bg-surface-1 text-muted-foreground hover:bg-surface-2"}`}
              >
                {watchlist.name}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete watchlist "${watchlist.name}"?`)) {
                    deleteWatchlistMutation.mutate(watchlist.id);
                  }
                }}
                className={`px-2 h-8 rounded-r-lg text-xs hairline border-l-0 hover:bg-red-500/20 hover:text-red-400 transition ${currentWatchlistId === watchlist.id ? "bg-primary/15" : "bg-surface-1"}`}
                title="Delete watchlist"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New Watchlist Form */}
      {showNewWatchlistForm && (
        <div className="rounded-2xl glass p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Watchlist name..."
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateWatchlist()}
              className="flex-1 px-3 h-9 rounded-lg bg-surface-2 hairline text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            <button
              onClick={handleCreateWatchlist}
              disabled={!newWatchlistName.trim() || createWatchlistMutation.isPending}
              className="px-4 h-9 rounded-lg bg-primary text-white hover:bg-primary/90 transition disabled:opacity-50 text-sm font-medium"
            >
              {createWatchlistMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </button>
            <button
              onClick={() => {
                setShowNewWatchlistForm(false);
                setNewWatchlistName("");
              }}
              className="px-4 h-9 rounded-lg bg-surface-2 hover:bg-surface-3 transition text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Watchlist Content */}
      {!currentWatchlistId ? (
        <div className="rounded-2xl glass p-12 text-center">
          <div className="text-muted-foreground mb-4">
            <Star className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No Watchlists</h3>
            <p className="text-sm">Create your first watchlist to start tracking symbols</p>
          </div>
          <button 
            onClick={() => setShowNewWatchlistForm(true)}
            className="inline-flex items-center gap-2 rounded-lg gradient-primary text-background px-4 h-10 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" /> Create Watchlist
          </button>
        </div>
      ) : watchlistLoading ? (
        <div className="rounded-2xl glass p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
        </div>
      ) : !enrichedItems.length ? (
        <div className="rounded-2xl glass p-12 text-center">
          <div className="text-muted-foreground mb-4">
            <Plus className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">Empty Watchlist</h3>
            <p className="text-sm">Add symbols to start tracking their performance</p>
          </div>
          <button 
            onClick={() => setShowSymbolSelector(true)}
            className="inline-flex items-center gap-2 rounded-lg gradient-primary text-background px-4 h-10 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" /> Add Symbols
          </button>
        </div>
      ) : (
        <div className="rounded-2xl glass overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground hairline-b">
            <div className="col-span-1"></div>
            <div className="col-span-3">Symbol</div>
            <div className="col-span-2 text-right">Last</div>
            <div className="col-span-2 text-right">Change</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Trend</div>
          </div>
          <div>
            {enrichedItems.map((item) => {
              const up = item.changePct >= 0;
              
              return (
                <div key={item.id} className="grid grid-cols-12 items-center px-4 py-3 hairline-b last:border-b-0 hover:bg-surface-2 transition group">
                  <div className="col-span-1 flex items-center gap-2 text-muted-foreground">
                    <GripVertical className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition" />
                    <button
                      onClick={() => removeSymbolMutation.mutate(item.id)}
                      className="opacity-0 group-hover:opacity-100 transition hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div 
                    className="col-span-3 cursor-pointer"
                    onClick={() => navigate({ to: `/stock/${item.symbol}` })}
                  >
                    <div className="text-sm font-semibold">{item.symbol}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{item.name}</div>
                  </div>
                  <div className="col-span-2 text-right num text-sm">
                    {item.price > 0 ? `$${fmtMoney(item.price)}` : "--"}
                  </div>
                  <div className="col-span-2 text-right">
                    {item.price > 0 ? <Delta value={item.changePct} /> : "--"}
                  </div>
                  <div className="col-span-2 text-right num text-xs text-muted-foreground">
                    {item.volume > 0 ? fmtCompact(item.volume) : "--"}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {item.sparkData.length > 0 ? (
                      <Sparkline data={item.sparkData} positive={up} width={92} height={28} />
                    ) : (
                      <div className="w-[92px] h-[28px] bg-surface-2 rounded opacity-50" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Symbol Selector Modal */}
      <SymbolSelector
        isOpen={showSymbolSelector}
        onClose={() => setShowSymbolSelector(false)}
        onSelect={handleAddSymbol}
        selectedSymbols={selectedSymbols}
      />
    </div>
  );
}
