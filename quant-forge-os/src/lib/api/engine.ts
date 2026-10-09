import { supabase } from "@/integrations/supabase/client";

// Client for the server-side NOVA Engine (VPS service, nginx /engine-api/).
// The engine itself checks that the token belongs to the control account, so
// hiding the page is not the only lock.

export type EngineMode = "off" | "paper" | "live";

export interface EngineConfig {
  riskUsd: number;
  targetUsd: number;
  topN: number;
  side: "both" | "long";
  maxNotional: number;
  dailyLossLimit: number;
  minRv: number;
  minGapPct: number;
  minPrice: number;
  minAtr: number;
}

export interface EngineCandidate {
  conid: number;
  symbol: string;
  name: string;
  scans: string[];
  rv: number;
  gapPct: number;
  atr: number;
  status: "watch" | "filtered" | "qualified" | "picked" | "entered" | "error";
  reason: string;
  dir?: number;
  orH?: number;
  orL?: number;
  move15?: number;
}

export interface EnginePosition {
  id: string;
  kind: "paper" | "live";
  symbol: string;
  conid: number;
  dir: 1 | -1;
  qty: number;
  entry: number | null;
  ref: number;
  stop: number;
  target: number;
  riskUsd: number;
  status: "pending" | "open" | "closed" | "cancelled";
  opened: number;
  closed: number | null;
  exit: number | null;
  why: string;
  pnl: number;
  last: number;
}

export interface EngineStatus {
  now: number;
  mode: EngineMode;
  config: EngineConfig;
  gateway: { authenticated: boolean; ok: boolean; checked: number; account: string | null };
  day: {
    key: string;
    phase: string;
    scanned: boolean;
    decided: boolean;
    halted: boolean;
    haltReason: string;
    universe: number;
    scanAt: number;
    decideAt: number;
    spy: { dir: number; chgPct: number } | null;
    entryMode: EngineMode | null;
    candidates: EngineCandidate[];
    positions: EnginePosition[];
    realized: number;
    unrealized: number;
    wins: number;
    losses: number;
  };
  log: { t: number; level: string; msg: string }[];
  schedule: { scan: string; entry: string; flatten: string };
}

export interface EngineDay {
  key: string;
  mode: EngineMode | null;
  trades: number;
  wins: number;
  pnl: number;
  haltReason: string;
  positions: Pick<EnginePosition, "symbol" | "dir" | "qty" | "entry" | "exit" | "why" | "pnl" | "kind">[];
}

async function engineFetch<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`/engine-api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Engine request failed (${res.status})`);
  return json as T;
}

export const getEngineStatus = () => engineFetch<EngineStatus>("/status");
export const getEngineHistory = () => engineFetch<EngineDay[]>("/history");
export const setEngineMode = (mode: EngineMode, confirm?: string) =>
  engineFetch<EngineStatus>("/mode", { mode, confirm });
export const setEngineConfig = (cfg: Partial<EngineConfig>) => engineFetch<EngineStatus>("/config", cfg);
export const killEngine = () => engineFetch<EngineStatus>("/kill", {});
export const closeEnginePosition = (id: string) => engineFetch<EngineStatus>("/close", { id });
