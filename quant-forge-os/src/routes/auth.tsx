import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { TrendingUp, Loader2, Mail, Lock, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BROKERS, activeBroker, setActiveBroker, type BrokerId } from "@/lib/broker";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Which broker this sign-in is for. Seeded from the last choice so a regular
  // user never has to pick twice, and committed before the password is sent so
  // the terminal is already pointed at the right desk when it loads.
  const [broker, setBroker] = useState<BrokerId>(() => activeBroker());
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/" });
  }, [session, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // Before the session exists, so the first render of the terminal already
      // asks the right broker and no query fires against the previous one.
      setActiveBroker(broker);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome back.");
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background relative overflow-hidden px-4">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] h-[420px] w-[420px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[420px] w-[420px] rounded-full bg-[oklch(0.78_0.18_152/0.18)] blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-9 w-9 rounded-xl gradient-primary grid place-items-center glow-primary">
            <TrendingUp className="h-5 w-5 text-background" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">NOVA</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-[0.22em]">Terminal</div>
          </div>
        </div>

        <div className="glass rounded-2xl p-7 hairline">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to NOVA</h1>
          <p className="text-sm text-muted-foreground mt-1">Access your AI trading terminal.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            {/* Broker first: it decides which account the terminal opens on, so
                it belongs above the credentials rather than buried in settings. */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Trade through
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BROKERS.map((b) => {
                  const on = broker === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBroker(b.id)}
                      aria-pressed={on}
                      className={`rounded-lg p-3 text-left transition ${
                        on
                          ? "bg-primary/10 ring-2 ring-primary/50"
                          : "bg-surface-1 hairline hover:bg-surface-2"
                      }`}
                    >
                      <div className="text-sm font-semibold">{b.short}</div>
                      <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">
                        {b.name}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10.5px] text-muted-foreground mt-2 leading-snug">
                {BROKERS.find((b) => b.id === broker)?.session}
              </p>
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@firm.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 pl-9 pr-3 rounded-lg bg-surface-1 hairline text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 pl-9 pr-3 rounded-lg bg-surface-1 hairline text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-lg gradient-primary text-background text-sm font-semibold glow-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          By continuing you agree to NOVA's Terms & Privacy.{" "}
          <Link to="/" className="hover:text-foreground">Back home</Link>
        </p>
      </div>
    </div>
  );
}
