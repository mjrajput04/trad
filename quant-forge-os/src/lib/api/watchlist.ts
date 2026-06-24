import { supabase } from "@/integrations/supabase/client";

export interface Watchlist {
  id: string;
  name: string;
  created_at: string;
}

export interface WatchlistItem {
  id: string;
  symbol: string;
  name: string | null;
  created_at: string;
}

export interface WatchlistWithItems extends Watchlist {
  items: WatchlistItem[];
}

// Get all watchlists for current user
export async function getWatchlists(): Promise<Watchlist[]> {
  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Get watchlist with items
export async function getWatchlistWithItems(watchlistId: string): Promise<WatchlistWithItems | null> {
  const { data: watchlist, error: watchlistError } = await supabase
    .from('watchlists')
    .select('*')
    .eq('id', watchlistId)
    .single();

  if (watchlistError) throw watchlistError;
  if (!watchlist) return null;

  const { data: items, error: itemsError } = await supabase
    .from('watchlist_items')
    .select('*')
    .eq('watchlist_id', watchlistId)
    .order('created_at', { ascending: true });

  if (itemsError) throw itemsError;

  return {
    ...watchlist,
    items: items || []
  };
}

// Create new watchlist
export async function createWatchlist(name: string): Promise<Watchlist> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('watchlists')
    .insert({ name, user_id: user.id })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Add symbol to watchlist
export async function addToWatchlist(watchlistId: string, symbol: string, name?: string): Promise<WatchlistItem> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('watchlist_items')
    .insert({
      watchlist_id: watchlistId,
      user_id: user.id,
      symbol,
      name
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Remove symbol from watchlist
export async function removeFromWatchlist(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('id', itemId);

  if (error) throw error;
}

// Delete watchlist
export async function deleteWatchlist(watchlistId: string): Promise<void> {
  const { error } = await supabase
    .from('watchlists')
    .delete()
    .eq('id', watchlistId);

  if (error) throw error;
}

// Check if symbol exists in any watchlist
export async function isSymbolInWatchlist(symbol: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('id')
    .eq('symbol', symbol)
    .limit(1);

  if (error) throw error;
  return (data?.length || 0) > 0;
}