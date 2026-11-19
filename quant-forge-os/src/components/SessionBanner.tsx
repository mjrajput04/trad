// What a dead broker session looks like without this.
//
// Every read fails at once, and each page falls back to its own default: $0.00
// on the tiles, nothing in Positions, an empty History, a flat chart. Those are
// the same shapes a genuinely empty account produces, so the screen reads as
// "the data is gone" rather than "nobody is signed in to the broker" — and the
// only thing saying otherwise was a pill in the header.
//
// This is not an edge case. E*TRADE's token dies every midnight ET and only a
// human with a browser can authorise a new one, and IBKR's gateway wants a
// daily two-factor login. It happens once a day, every day, so it is worth
// saying plainly, on whatever page they are standing on, along with what to do.

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getAuthStatus, ensureSession, tickle, gatewayLoginUrl } from "@/lib/api/broker";
import { activeBroker, brokerInfo } from "@/lib/broker";
import { toast } from "sonner";

export function SessionBanner() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // The same query key the header pill uses, so this costs no extra polling.
  const { data: status } = useQuery({
    queryKey: [activeBroker(), "ibkr-auth"],
    queryFn: getAuthStatus,
    refetchInterval: 30_000,
  });

  // getAuthStatus holds a session "up" for 90s past a failed check, so a
  // dropped request or a renew in flight never flashes this up.
  if (!status || status.authenticated) return null;

  const broker = brokerInfo();

  // Try to revive the server-side session first — an idle E*TRADE token renews
  // without a human, and so does a sleeping IBKR gateway. Only a token that is
  // genuinely dead needs someone to log in.
  const reconnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await tickle().catch(() => {});
      await ensureSession(true).catch(() => {});
      const fresh = await getAuthStatus().catch(() => null);
      if (fresh?.authenticated) {
        toast.success(`${broker.short} session reconnected — no login needed`);
        qc.invalidateQueries();
        return;
      }
      const url = gatewayLoginUrl();
      toast.info(`${broker.short} needs a fresh login — opening it now`);
      // E*TRADE authorises on our own Broker page; IBKR's gateway is elsewhere.
      if (url.startsWith("/")) navigate({ to: url });
      else window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-2 bg-warn/10 border-b border-warn/30">
      <div className="flex items-center gap-3 flex-wrap">
        <AlertTriangle className="h-4 w-4 text-warn shrink-0" />
        <div className="min-w-0 flex-1 text-[11.5px] leading-snug">
          <span className="font-semibold">
            {broker.name} is not connected — the figures below are not your account.
          </span>{" "}
          <span className="text-muted-foreground">
            {broker.session} Nothing has been lost at the broker; this terminal just cannot read it
            until the session is back.
          </span>
        </div>
        <button
          onClick={reconnect}
          disabled={busy}
          className="h-8 px-3 rounded-lg bg-warn text-background text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? "Reconnecting…" : `Reconnect ${broker.short}`}
        </button>
      </div>
    </div>
  );
}
