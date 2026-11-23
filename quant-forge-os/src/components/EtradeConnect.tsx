// E*TRADE connection panel — the one manual step of the trading day.
//
// The IBKR build sent the user to the gateway's own login page (username + password + 2FA).
// E*TRADE uses OAuth 1.0a instead: the trader approves NOVA on E*TRADE's site and brings back
// a 5-character verification code. NOVA never sees the E*TRADE password, which is why this
// panel asks for a code and never for credentials.
//
// It also states the thing a trader must not be surprised by: the token dies at MIDNIGHT ET,
// every day, and no amount of server-side keepalive can extend it.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { startAuth, completeAuth, type AuthStatus } from "@/lib/api/etrade";

// E*TRADE's request token — the one in the authorise link — is good for about
// five minutes and no longer. Past that the page answers "Due to a logon delay
// or other issue, your authentication could not be completed", which says
// nothing about a clock and sends people hunting for a broken integration.
//
// The link used to sit on this panel indefinitely, so a tab left open while
// something else got done, or a second Broker tab that quietly replaced the
// first one's token, meant clicking a link that was already dead. Hold it for
// as long as it is actually worth something and say plainly when it is not.
const LINK_TTL_MS = 5 * 60_000;

export function EtradeConnect({ status }: { status?: AuthStatus | null }) {
  const qc = useQueryClient();
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [verifier, setVerifier] = useState("");
  const [busy, setBusy] = useState(false);

  const expired = status?.state === "EXPIRED";

  // Only tick while a link is live, so the panel costs nothing the rest of the day.
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const msLeft = startedAt === null ? 0 : LINK_TTL_MS - (now - startedAt);
  const linkDead = startedAt !== null && msLeft <= 0;
  const countdown = `${Math.floor(Math.max(0, msLeft) / 60000)}:${String(
    Math.floor((Math.max(0, msLeft) % 60000) / 1000),
  ).padStart(2, "0")}`;

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { authorizeUrl: url } = await startAuth();
      setAuthorizeUrl(url);
      setStartedAt(Date.now());
      setNow(Date.now());
      setVerifier("");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach E*TRADE", { duration: 20000 });
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !verifier.trim()) return;
    setBusy(true);
    try {
      await completeAuth(verifier);
      setVerifier("");
      setAuthorizeUrl(null);
      setStartedAt(null);
      toast.success("E*TRADE connected");
      qc.invalidateQueries();
    } catch (err) {
      // Loud and persistent: a missed connection error means a dead trading day.
      toast.error(err instanceof Error ? err.message : "Connection failed", { duration: 20000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg hairline bg-surface-1 p-3">
      {expired && (
        <div className="mb-3 rounded-md bg-warn/10 text-warn text-[11px] leading-relaxed px-2.5 py-2">
          E*TRADE tokens expire at <strong>midnight US Eastern</strong>, every day. Nothing on the
          server can extend one past that — reconnect below to trade today.
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-bull" />
        Your E*TRADE password is never entered here and never stored.
      </div>

      <button
        onClick={begin}
        disabled={busy}
        className="mt-2.5 w-full h-10 rounded-lg bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
        {linkDead ? "1 — Start again on E*TRADE" : "1 — Authorise on E*TRADE"}
      </button>

      {authorizeUrl && !linkDead && (
        <>
          <a
            href={authorizeUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 block text-center text-[10px] text-muted-foreground underline"
          >
            Page didn't open? Open the E*TRADE authorisation page
          </a>
          <div className="mt-1 text-center text-[10px] text-muted-foreground">
            This link is good for <span className="num font-semibold">{countdown}</span> — finish
            before it runs out.
          </div>
        </>
      )}

      {linkDead && (
        <div className="mt-2 rounded-md bg-warn/10 text-warn text-[11px] leading-relaxed px-2.5 py-2 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>
            That E*TRADE page has expired — their link only lasts five minutes, and a code from it
            will no longer be accepted. Press the button above for a fresh one and finish straight
            away. Only one of these can be open at a time, so close any other Broker tab first.
          </span>
        </div>
      )}

      <form onSubmit={finish} className="mt-2.5 flex gap-2">
        <input
          value={verifier}
          onChange={(e) => setVerifier(e.target.value.toUpperCase())}
          placeholder="2 — paste the code"
          maxLength={12}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 h-9 rounded-lg hairline bg-surface-2 px-3 font-mono text-xs uppercase tracking-widest outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={busy || !verifier.trim() || !authorizeUrl || linkDead}
          className="h-9 px-4 rounded-lg bg-bull/15 text-bull text-xs font-semibold hover:bg-bull/25 transition disabled:opacity-40"
        >
          Connect
        </button>
      </form>
    </div>
  );
}

/**
 * Loud, persistent banner for a stalled bracket watcher. Never auto-dismisses: an unwatched
 * take-profit is a live risk, and a toast the trader scrolled past is the same as no warning.
 */
export function BracketHealthBanner({ status }: { status?: AuthStatus | null }) {
  const oco = status?.oco;
  if (!oco || oco.healthy || oco.active === 0) return null;

  return (
    <div className="mb-4 rounded-2xl hairline bg-bear/10 p-4 text-xs leading-relaxed text-bear">
      <div className="font-semibold">Bracket monitor is not running</div>
      <p className="mt-1 text-foreground/80">
        {oco.active} bracket{oco.active === 1 ? "" : "s"} registered, but the target watcher is{" "}
        {oco.staleMs > 0 ? `${Math.round(oco.staleMs / 1000)}s stale` : "not reporting"}.{" "}
        <strong>Your stops are still live at E*TRADE</strong> — they are real broker orders — but
        profit targets are <strong>not</strong> being watched. Manage exits manually until this clears.
      </p>
      {oco.lastError && <p className="mt-2 font-mono text-[10px] opacity-75">{oco.lastError}</p>}
    </div>
  );
}
