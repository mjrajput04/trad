import { createFileRoute, Outlet, useNavigate, useRouterState, Link } from "@tanstack/react-router";
import React, { Component, useEffect, type ReactNode } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { Topbar } from "@/components/Topbar";
import { Ticker } from "@/components/Ticker";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

// Keeps a single page's crash from blanking the whole app. The sidebar/topbar
// stay put and the user can navigate away; keying it on the pathname resets it
// on every navigation.
class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-10">
          <div className="max-w-md mx-auto rounded-2xl glass p-8 text-center">
            <AlertTriangle className="h-7 w-7 text-warn mx-auto mb-3" />
            <div className="text-base font-semibold mb-1">This section hit an error</div>
            <div className="text-xs text-muted-foreground mb-4">{this.state.error.message}</div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => this.setState({ error: null })}
                className="h-9 px-4 rounded-lg bg-primary text-background text-xs font-semibold"
              >
                Try again
              </button>
              <Link to="/positions" className="h-9 px-4 rounded-lg hairline bg-surface-1 text-xs font-semibold inline-flex items-center">
                Go to Positions
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <AppSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <Ticker />
        {/* pb on mobile keeps the floating menu button from covering content */}
        <main className="flex-1 min-w-0 overflow-x-hidden pb-24 md:pb-0">
          <RouteErrorBoundary key={pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
