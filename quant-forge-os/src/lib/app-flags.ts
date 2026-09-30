import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Global switches shared by every device, stored in Supabase `app_flags`
// (id text PK, value bool, updated_at). RLS: any signed-in user may READ,
// only the control account may WRITE — so a client can never flip their own
// switches, not even by calling the API directly.
// ---------------------------------------------------------------------------

/** The one account that owns the controls and keeps the original layout. */
export const CONTROL_EMAIL = "vivekvora32262@gmail.com";

export const isControlAccount = (email?: string | null) =>
  !!email && email.toLowerCase() === CONTROL_EMAIL;

/** Flag ids used by the app. */
export const FLAG_MAINTENANCE = "maintenance";
export const FLAG_TRADING = "trading_enabled";

const flags = () => (supabase as any).from("app_flags");

export async function getFlag(id: string): Promise<boolean> {
  const { data, error } = await flags().select("value").eq("id", id).maybeSingle();
  if (error) return false; // fail closed for trading, open for maintenance (see callers)
  return !!data?.value;
}

export async function setFlag(id: string, value: boolean): Promise<void> {
  const { error } = await flags().upsert({
    id,
    value,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Poll a flag. 10s is fast enough that a switch feels immediate on every device. */
export function useAppFlag(id: string) {
  return useQuery({
    queryKey: ["app-flag", id],
    queryFn: () => getFlag(id),
    refetchInterval: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Trading permission
// ---------------------------------------------------------------------------
// The control account always trades. Every other account trades only while the
// control account has switched `trading_enabled` ON; until then Buy/Sell are
// rendered faded and inert, and the broker layer refuses an order even if a
// button were re-enabled by hand.

export {
  setRuntimeTradingAllowed,
  isRuntimeTradingAllowed,
  TRADING_DISABLED_MESSAGE,
} from "./trade-guard";

export function useTradingAllowed(email?: string | null) {
  const control = isControlAccount(email);
  const { data: on = false, isLoading } = useAppFlag(FLAG_TRADING);
  return {
    /** May this session place or close orders? */
    allowed: control || on,
    /** Is this the account that owns the switch? */
    isControl: control,
    loading: !control && isLoading,
  };
}
