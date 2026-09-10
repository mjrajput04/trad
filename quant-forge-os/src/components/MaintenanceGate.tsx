import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hand } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

// NASSCORD SLM maintenance switch. Flipping it ON (Settings → visible only to
// the admins below) shows every OTHER logged-in user a blocking "hold on"
// overlay within ~10s, everywhere in the app. State lives in Supabase
// (app_flags.maintenance) so it reaches all devices; RLS lets everyone read it
// but only these admin emails write it.
// ONLY this identity is exempt from the hold-on screen (and sees the toggle).
// Every other account — including the owner's trading login — gets blocked
// while the switch is ON.
export const NASSCORD_ADMINS = [
  "vivekvora32262@gmail.com",
];

export const isNasscordAdmin = (email?: string | null) =>
  !!email && NASSCORD_ADMINS.includes(email.toLowerCase());

const flags = () => (supabase as any).from("app_flags");

// The hold-on screen only blocks during REGULAR US market hours
// (9:30–16:00 ET, weekdays). Pre-market, after-hours and closed days show the
// platform normally even while the switch is ON.
export function isRegularMarketHours(): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export async function getMaintenanceFlag(): Promise<boolean> {
  const { data, error } = await flags().select("value").eq("id", "maintenance").maybeSingle();
  if (error) return false; // fail open — never lock users out on a read error
  return !!data?.value;
}

export async function setMaintenanceFlag(on: boolean): Promise<void> {
  const { error } = await flags().upsert({
    id: "maintenance",
    value: on,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Fullscreen block for non-admin users while the switch is ON. */
export function MaintenanceGate() {
  const { user } = useAuth();
  const { data: on = false } = useQuery({
    queryKey: ["nasscord-flag"],
    queryFn: getMaintenanceFlag,
    refetchInterval: 10_000,
  });
  // Re-evaluated every 30s so the gate appears/disappears at the open/close
  // without a reload.
  const { data: regularHours = false } = useQuery({
    queryKey: ["nasscord-clock"],
    queryFn: () => isRegularMarketHours(),
    refetchInterval: 30_000,
  });

  const active = on && regularHours && !isNasscordAdmin(user?.email);

  // Freeze the page behind the gate: nothing scrolls, nothing peeks through.
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement.style.overflow;
    const body = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = html;
      document.body.style.overflow = body;
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-background p-6 touch-none overscroll-none">
      <div className="max-w-md w-full rounded-2xl glass hairline p-8 text-center">
        <Hand className="h-10 w-10 text-warn mx-auto mb-4" />
        <h2 className="text-lg font-bold mb-2">Hold your hands!</h2>
        <p className="text-sm text-muted-foreground">
          Your <span className="font-semibold text-primary">NASSCORD SLM</span> is working on it —
          we&apos;ll be back in a moment.
        </p>
        <div className="mt-6 flex items-center justify-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

/** Settings card with the switch — render only for admins. */
export function NasscordToggle() {
  const qc = useQueryClient();
  const { data: on = false } = useQuery({
    queryKey: ["nasscord-flag"],
    queryFn: getMaintenanceFlag,
    refetchInterval: 10_000,
  });
  const toggle = useMutation({
    mutationFn: (next: boolean) => setMaintenanceFlag(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nasscord-flag"] }),
  });

  return (
    <section className="rounded-2xl glass overflow-hidden">
      <div className="px-5 py-3 hairline-b text-sm font-semibold">NASSCORD SLM</div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Hold-on mode</div>
          <div className="text-[11px] text-muted-foreground">
            ON = every non-admin user sees the &quot;Hold your hands — NASSCORD SLM is working on
            it&quot; screen — but only during regular market hours (9:30–16:00 ET, weekdays).
            Pre-market, after-hours and closed days stay normal for everyone.
          </div>
        </div>
        <button
          onClick={() => toggle.mutate(!on)}
          disabled={toggle.isPending}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-warn" : "bg-surface-2 hairline"}`}
          aria-label="Toggle NASSCORD SLM hold-on mode"
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background transition"
            style={{ left: on ? 22 : 2 }}
          />
        </button>
      </div>
      {on && (
        <div className="px-5 pb-4 text-[11px] text-warn">
          {isRegularMarketHours()
            ? "Hold-on mode is LIVE — all non-admin users are currently blocked."
            : "Hold-on mode is ARMED — it will block non-admin users when the market opens (9:30 ET)."}
        </div>
      )}
    </section>
  );
}
