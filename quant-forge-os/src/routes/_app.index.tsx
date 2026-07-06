import { createFileRoute, redirect } from "@tanstack/react-router";

// The dashboard was removed — land on Positions (a stable IBKR page that
// renders even when data is still loading or the gateway is offline).
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    throw redirect({ to: "/positions" });
  },
});
