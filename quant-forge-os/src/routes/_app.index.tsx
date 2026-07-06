import { createFileRoute, redirect } from "@tanstack/react-router";

// The dashboard was removed — land on Alerts (the live TradeScope feed, which
// works even before the IBKR gateway session is up).
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    throw redirect({ to: "/alerts" });
  },
});
