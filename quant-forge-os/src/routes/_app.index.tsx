import { createFileRoute, redirect } from "@tanstack/react-router";

// Land on AI Stock Alerts — the page the day starts from. (It has its own
// error boundary + defensive gates, so a bad alert can't blank the app.)
export const Route = createFileRoute("/_app/")({
  beforeLoad: () => {
    throw redirect({ to: "/alerts" });
  },
});
