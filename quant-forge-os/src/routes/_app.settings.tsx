import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTrading } from "@/lib/trading-context";
import { getAuthStatus, GATEWAY_LOGIN_URL } from "@/lib/api/ibkr";
import { AdminUsers } from "@/components/AdminUsers";

const ADMIN_EMAIL = "nssphx@gmail.com";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · NOVA" }, { name: "description", content: "Account, broker connection and trading mode." }] }),
  component: Settings,
});

function Settings() {
  const { user, signOut } = useAuth();
  const { isPaper, setIsPaper, paperConfigured, liveAccount, paperAccount, currentAccount } = useTrading();

  const { data: authStatus } = useQuery({
    queryKey: ["ibkr-auth"],
    queryFn: getAuthStatus,
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Account, broker connection and trading mode.</p>
      </div>

      <section className="rounded-2xl glass overflow-hidden">
        <div className="px-5 py-3 hairline-b text-sm font-semibold">Profile</div>
        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="User ID" value={user?.id ? `${user.id.slice(0, 8)}…` : "—"} />
        <div className="px-5 py-3.5 flex justify-end">
          <button onClick={() => signOut()} className="text-[11px] text-bear hover:underline">Sign out</button>
        </div>
      </section>

      <section className="rounded-2xl glass overflow-hidden">
        <div className="px-5 py-3 hairline-b text-sm font-semibold">IBKR Connection</div>
        <Row label="Gateway" value={GATEWAY_LOGIN_URL} />
        <Row
          label="Session"
          value={
            authStatus?.authenticated
              ? "Authenticated"
              : authStatus?.connected
                ? "Connected (not authenticated)"
                : "Disconnected"
          }
        />
        <Row label="Active account" value={currentAccount} />
        <div className="px-5 py-3.5 flex justify-end">
          <a href={GATEWAY_LOGIN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] text-info hover:underline">
            <ExternalLink className="h-3 w-3" /> Open gateway login
          </a>
        </div>
      </section>

      <section className="rounded-2xl glass overflow-hidden">
        <div className="px-5 py-3 hairline-b text-sm font-semibold">Trading Mode</div>
        <Row label="Live account" value={liveAccount} />
        <Row label="Paper account" value={paperConfigured ? paperAccount : "Not configured"} />
        <div className="grid grid-cols-3 px-5 py-3.5 items-center">
          <div className="text-xs text-muted-foreground">Mode</div>
          <div className="col-span-2 flex items-center justify-between">
            <span className="text-sm num">{isPaper ? "Paper" : "Live"}</span>
            <button
              onClick={() => setIsPaper(!isPaper)}
              disabled={!paperConfigured}
              className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed ${isPaper ? "bg-warn" : "bg-bull"}`}
            >
              <span className="absolute top-0.5 h-5 w-5 rounded-full bg-background transition" style={{ left: isPaper ? 2 : 22 }} />
            </button>
          </div>
        </div>
        <div className="px-5 pb-4 text-[11px] text-muted-foreground">
          {paperConfigured
            ? "The gateway session must be logged into the selected account for its data and orders to work."
            : "Paper mode is disabled — set VITE_IBKR_PAPER_ACCOUNT_ID to your paper account to enable it."}
        </div>
      </section>

      {user?.email?.toLowerCase() === ADMIN_EMAIL && <AdminUsers adminEmail={ADMIN_EMAIL} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 px-5 py-3.5 items-center hairline-b last:border-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm num break-all">{value}</div>
    </div>
  );
}
