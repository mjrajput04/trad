import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Unlock } from "lucide-react";
import { FLAG_TRADING, setFlag, useAppFlag } from "@/lib/app-flags";

// Control-account-only card: turns Buy/Sell on or off for every OTHER account.
// While it is off those accounts still see the whole terminal — alerts,
// positions, history — but the trade buttons render faded and inert, and the
// broker layer refuses an order even if a button were re-enabled by hand.
export function TradingControl() {
  const qc = useQueryClient();
  const { data: on = false } = useAppFlag(FLAG_TRADING);
  const toggle = useMutation({
    mutationFn: (next: boolean) => setFlag(FLAG_TRADING, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-flag", FLAG_TRADING] }),
  });

  return (
    <section className="rounded-2xl glass overflow-hidden">
      <div className="px-5 py-3 hairline-b text-sm font-semibold">Client trading</div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-1.5">
            {on ? <Unlock className="h-3.5 w-3.5 text-bull" /> : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            Buy / Sell for other accounts
          </div>
          <div className="text-[11px] text-muted-foreground">
            OFF = every other signed-in account sees the terminal in view-only mode, with the trade
            buttons faded and disabled. ON = they can place and close orders on their own broker
            account. Your own account is never affected.
          </div>
        </div>
        <button
          onClick={() => toggle.mutate(!on)}
          disabled={toggle.isPending}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-bull" : "bg-surface-2 hairline"}`}
          aria-label="Toggle client trading"
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background transition"
            style={{ left: on ? 22 : 2 }}
          />
        </button>
      </div>
      <div className={`px-5 pb-4 text-[11px] ${on ? "text-bull" : "text-muted-foreground"}`}>
        {on ? "Trading is ENABLED for other accounts." : "Other accounts are in view-only mode."}
      </div>
    </section>
  );
}
