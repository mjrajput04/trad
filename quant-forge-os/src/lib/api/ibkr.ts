// IBKR Client Portal Gateway API layer.
// Dev: requests go through the vite proxy at /ibkr (see vite.config.ts).
// Prod: requests go directly to the gateway proxy (backend.nassphx.com) with
// cross-site cookies (SameSite=None, rewritten by server-proxy.cjs on the VPS).

const GATEWAY_URL: string =
  import.meta.env.VITE_IBKR_GATEWAY_URL ?? "https://backend.nassphx.com";
const BASE = import.meta.env.DEV ? "/ibkr" : `${GATEWAY_URL}/v1/api`;

/** Where the user logs into the IBKR gateway (opens in a new tab). */
export const GATEWAY_LOGIN_URL = GATEWAY_URL;

let CURRENT_ACCOUNT = import.meta.env.VITE_IBKR_ACCOUNT_ID ?? "U25901412";

export function setIBKRAccount(id: string) {
  CURRENT_ACCOUNT = id;
}

export function getIBKRAccount() {
  return CURRENT_ACCOUNT;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

function rawFetch(path: string, options?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    mode: "cors",
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
}

export interface AuthStatus {
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
}

// IBKR CP has two subsystems that each need a one-time init call:
//   - /iserver/accounts  → REQUIRED before any /iserver/* market-data call.
//     Skip it and the gateway returns 400 on snapshot/history — even for a
//     fully authenticated session. This must run regardless of what
//     /iserver/auth/status reports (that flag can lag behind a working SSO
//     session, so we never gate the prime on it).
//   - /portfolio/accounts → primes /portfolio/* (summary, positions); best-effort.
let brokerageReady = false;
let brokeragePromise: Promise<void> | null = null;
let reauthTried = false;
async function initBrokerage() {
  if (brokerageReady) return;
  if (!brokeragePromise) {
    brokeragePromise = (async () => {
      try {
        let r = await rawFetch("/iserver/accounts");
        // After an SSO login the /portfolio/* session works, but the iserver
        // (trading + market-data) session is often NOT live yet — /iserver/accounts
        // and every /iserver/marketdata/* call then return 400. /iserver/reauthenticate
        // brings the brokerage session up; it comes up asynchronously, so poll
        // /iserver/accounts a few times (tickle in between) until it succeeds.
        if (!r.ok && !reauthTried) {
          reauthTried = true;
          // "no bridge" means the brokerage session was never INITIALIZED
          // (only the SSO + portfolio session exist). ssodh/init with
          // compete:true creates/takes-over the brokerage session; then
          // reauthenticate + tickle bring the market-data bridge up. Poll
          // /iserver/accounts until it succeeds (session comes up async).
          await rawFetch("/iserver/auth/ssodh/init", {
            method: "POST",
            body: JSON.stringify({ publish: true, compete: true }),
          }).catch(() => {});
          await rawFetch("/iserver/reauthenticate", { method: "POST" }).catch(() => {});
          for (let i = 0; i < 6 && !r.ok; i++) {
            await new Promise((res) => setTimeout(res, 2000));
            await rawFetch("/tickle", { method: "POST" }).catch(() => {});
            r = await rawFetch("/iserver/accounts");
          }
        }
        rawFetch("/portfolio/accounts").catch(() => {}); // best-effort prime
        if (r.ok) brokerageReady = true;
      } catch {
        /* retried on next call */
      }
    })();
  }
  await brokeragePromise;
  brokeragePromise = null; // allow a retry next call if it didn't take
}

async function bootstrapSession(): Promise<boolean> {
  // 1. Existing session?
  try {
    const res = await rawFetch("/iserver/auth/status", { method: "POST" });
    if (res.ok) {
      const st = (await res.json()) as AuthStatus;
      if (st.authenticated) {
        await initBrokerage();
        return true;
      }
      // Session exists but idle → try to re-activate it.
      if (st.connected) {
        const init = await rawFetch("/iserver/auth/ssodh/init", {
          method: "POST",
          body: JSON.stringify({ publish: true, compete: true }),
        });
        if (init.ok) {
          const j = await init.json().catch(() => null);
          if (j?.authenticated) {
            await initBrokerage();
            return true;
          }
        }
      }
    }
  } catch {
    /* fall through */
  }
  return false;
}

let sessionPromise: Promise<boolean> | null = null;

/** Make sure we have an authenticated brokerage session. */
export async function ensureSession(force = false): Promise<boolean> {
  if (force) {
    sessionPromise = null;
    brokerageReady = false;
    brokeragePromise = null;
    reauthTried = false;
  }
  if (!sessionPromise) sessionPromise = bootstrapSession();
  const ok = await sessionPromise;
  if (!ok) sessionPromise = null; // allow a retry on the next call
  return ok;
}

/** Keepalive ping. The gateway drops idle sessions after a few minutes. */
export async function tickle() {
  const res = await rawFetch("/tickle", { method: "POST" });
  if (!res.ok) throw new Error(`Tickle failed: ${res.status}`);
  return res.json();
}

let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

// Tickle, and if the session went idle anyway, revive it in place
// (ssodh/init + reauthenticate) so the user never has to click reconnect.
async function pingOrRevive(onRevived?: () => void) {
  try {
    await tickle();
  } catch {
    const ok = await ensureSession(true).catch(() => false);
    if (ok) onRevived?.();
  }
}

/** Start a background tickle every 60s. Safe to call multiple times. */
export function startSessionKeepalive(onRevived?: () => void) {
  if (keepaliveTimer || typeof window === "undefined") return;
  keepaliveTimer = setInterval(() => {
    pingOrRevive(onRevived);
  }, 60_000);
  // Browsers throttle background-tab timers to a crawl, so the interval above
  // effectively stops while the user is on another tab. The moment the tab is
  // foregrounded again, ping/revive immediately instead of waiting a minute.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pingOrRevive(onRevived);
  });
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await rawFetch("/iserver/auth/status", { method: "POST" });
  if (!res.ok) {
    return { authenticated: false, connected: false, competing: false };
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

async function ibkr<T>(path: string, options?: RequestInit): Promise<T> {
  await ensureSession();
  // Prime /iserver/accounts before any data request. Runs once (guarded by
  // brokerageReady). Without this, /iserver/marketdata/* returns 400 even
  // though /portfolio/* works — which is why quotes/charts were blank while
  // the account summary loaded.
  await initBrokerage();

  let res = await rawFetch(path, options);

  // Auth expired mid-session → re-bootstrap once and retry.
  if (res.status === 401 || res.status === 403) {
    const ok = await ensureSession(true);
    if (!ok) {
      throw new Error(
        "Not logged in to IBKR. Open the gateway and log in first."
      );
    }
    res = await rawFetch(path, options);
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 500 && text.includes("not logged in")) {
      sessionPromise = null;
      throw new Error("Not logged in to IBKR. Open the gateway and log in first.");
    }
    throw new Error(`IBKR ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseIBKRNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (!val || typeof val !== "string") return 0;
  // Strip change-direction prefixes like 'C', 'H', 'L' and thousands commas.
  const clean = val.replace(/^[A-Z]/, "").replace(/,/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Volume comes back formatted ("12.3M"); expand K/M/B suffixes.
function parseVolume(val: unknown): number {
  if (typeof val === "number") return val;
  if (!val || typeof val !== "string") return 0;
  const m = val.replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

// ---------------------------------------------------------------------------
// Contract-ID (conid) resolution — resolved live from IBKR, cached locally.
// ---------------------------------------------------------------------------

// Verified US-listing conids (from /iserver/secdef/search results saved in
// repo) used to seed the cache so the UI has data before the first resolve.
const VERIFIED_CONIDS: Record<string, number> = {
  AAPL: 265598,
  MSFT: 272093,
  NVDA: 4815747,
  GOOGL: 208813719,
  GOOG: 208813720,
  AMZN: 3691937,
  META: 107113386,
  TSLA: 76792991,
  NFLX: 15124833,
  AMD: 4391,
  V: 49462172,
  JPM: 1520593,
};

const CONID_CACHE_KEY = "nova_conids_v2";

const conidCache = new Map<string, number>(Object.entries(VERIFIED_CONIDS));

function loadConidCache() {
  if (typeof window === "undefined") return;
  try {
    const saved = JSON.parse(localStorage.getItem(CONID_CACHE_KEY) ?? "{}");
    for (const [sym, conid] of Object.entries(saved)) {
      if (typeof conid === "number") conidCache.set(sym, conid);
    }
  } catch {
    /* corrupt cache — ignore */
  }
}
loadConidCache();

function saveConidCache() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CONID_CACHE_KEY,
      JSON.stringify(Object.fromEntries(conidCache))
    );
  } catch {
    /* quota — ignore */
  }
}

/** Bulk-resolve symbols to their US-listing conid via /trsrv/stocks. */
export async function resolveConids(
  symbols: string[]
): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const missing = unique.filter((s) => !conidCache.has(s));

  if (missing.length > 0) {
    try {
      const data = await ibkr<Record<string, any[]>>(
        `/trsrv/stocks?symbols=${encodeURIComponent(missing.join(","))}`
      );
      for (const sym of missing) {
        for (const entry of data?.[sym] ?? []) {
          const us = (entry.contracts ?? []).find((c: any) => c.isUS);
          if (us?.conid) {
            conidCache.set(sym, us.conid);
            break;
          }
        }
      }
      saveConidCache();
    } catch (err) {
      console.warn("conid bulk resolve failed:", err);
    }
  }

  const out: Record<string, number> = {};
  for (const sym of unique) {
    const conid = conidCache.get(sym);
    if (conid) out[sym] = conid;
  }
  return out;
}

/** Resolve one symbol; falls back to /iserver/secdef/search. */
export async function getConid(symbol: string): Promise<number | null> {
  const sym = symbol.toUpperCase();
  const cached = conidCache.get(sym);
  if (cached) return cached;

  const bulk = await resolveConids([sym]);
  if (bulk[sym]) return bulk[sym];

  try {
    const search = await ibkr<any[]>(
      `/iserver/secdef/search?symbol=${encodeURIComponent(sym)}&name=false&secType=STK`
    );
    const hit = (search ?? []).find(
      (r) => r.symbol?.toUpperCase() === sym && Number(r.conid) > 0
    );
    if (hit) {
      const conid = Number(hit.conid);
      conidCache.set(sym, conid);
      saveConidCache();
      return conid;
    }
  } catch (err) {
    console.warn(`secdef search failed for ${sym}:`, err);
  }
  return null;
}

// US primary listing exchanges — used to keep search results to instruments
// the app can actually trade/quote (avoids foreign dupes like MEXI/EBS/TSE).
const US_EXCHANGES = /\b(NASDAQ|NYSE|ARCA|AMEX|BATS|IEX|PINK|NMS|NYSENAT)\b/i;

/** Free-text search for US symbols/companies (for the search bar). */
export async function searchSymbols(query: string) {
  const results = await ibkr<any[]>(
    `/iserver/secdef/search?symbol=${encodeURIComponent(query)}&name=true&secType=STK`
  );
  return (results ?? [])
    .filter((r) => Number(r.conid) > 0)
    .map((r) => ({
      conid: Number(r.conid),
      symbol: r.symbol as string,
      name: (r.companyName ?? r.companyHeader ?? r.symbol) as string,
      exchange: (r.companyHeader?.match(/\(([^)]+)\)\s*$/)?.[1] ?? "") as string,
    }))
    // Keep only US-listed matches (or ones with no exchange tag, e.g. exact
    // ticker hits), so a US ticker never resolves to a foreign instrument.
    .filter((r) => !r.exchange || US_EXCHANGES.test(r.exchange));
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export async function getAccountSummary() {
  const data = await ibkr<Record<string, { amount: number; currency: string }>>(
    `/portfolio/${CURRENT_ACCOUNT}/summary`
  );
  return {
    netLiquidation: parseIBKRNum(data["netliquidation"]?.amount),
    buyingPower: parseIBKRNum(data["buyingpower"]?.amount),
    availableFunds: parseIBKRNum(data["availablefunds"]?.amount),
    initMarginReq: parseIBKRNum(data["initmarginreq"]?.amount),
    maintMarginReq: parseIBKRNum(data["maintmarginreq"]?.amount),
    excessLiquidity: parseIBKRNum(data["excessliquidity"]?.amount),
    totalCash: parseIBKRNum(data["totalcashvalue"]?.amount),
    unrealizedPnl: parseIBKRNum(data["unrealizedpnl"]?.amount),
    realizedPnl: parseIBKRNum(data["realizedpnl"]?.amount),
  };
}

export interface Position {
  conid: number;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  side: "LONG" | "SHORT";
  sector: string;
  assetClass: string;
}

export async function getPositions(): Promise<Position[]> {
  // The endpoint pages 30 positions at a time; walk pages until one is short.
  const raw: any[] = [];
  for (let page = 0; page < 20; page++) {
    const chunk = await ibkr<any[]>(
      `/portfolio/${CURRENT_ACCOUNT}/positions/${page}`
    );
    if (!chunk?.length) break;
    raw.push(...chunk);
    if (chunk.length < 30) break;
  }

  return raw
    .filter((p) => p.position !== 0)
    .map((p) => {
      const avgCost = parseIBKRNum(p.avgCost);
      const mktPrice = parseIBKRNum(p.mktPrice);
      const isLong = p.position > 0;
      // For shorts, a falling price is a GAIN — flip the sign so % matches P&L.
      const pnlPct =
        avgCost > 0 ? (isLong ? 1 : -1) * ((mktPrice - avgCost) / avgCost) * 100 : 0;
      return {
        conid: p.conid,
        symbol: p.ticker ?? p.contractDesc,
        name: p.contractDesc,
        quantity: p.position,
        entryPrice: avgCost,
        currentPrice: mktPrice,
        marketValue: parseIBKRNum(p.mktValue),
        pnl: parseIBKRNum(p.unrealizedPnl),
        pnlPct,
        side: isLong ? ("LONG" as const) : ("SHORT" as const),
        sector: p.sector ?? "",
        assetClass: p.assetClass ?? "STK",
      };
    });
}

/** The gateway caches /portfolio positions; call this after trading. */
export async function invalidatePositionsCache() {
  try {
    await ibkr(`/portfolio/${CURRENT_ACCOUNT}/positions/invalidate`, {
      method: "POST",
    });
  } catch {
    /* non-fatal — data is just up to ~1 min stale */
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus = "Working" | "Filled" | "Canceled" | "Rejected";

function mapStatus(s: string): OrderStatus {
  if (["Submitted", "PreSubmitted", "PendingSubmit"].includes(s)) return "Working";
  if (s === "Filled") return "Filled";
  if (["Cancelled", "PendingCancel"].includes(s)) return "Canceled";
  return "Rejected";
}

export async function getOrders() {
  const data = await ibkr<{ orders: any[] }>("/iserver/account/orders");
  return (data?.orders ?? []).map((o) => ({
    orderId: o.orderId,
    conid: Number(o.conid) || 0,
    symbol: o.ticker ?? o.symbol,
    side: o.side === "B" || o.side === "BUY" ? "BUY" : "SELL",
    type: o.orderType,
    quantity: parseIBKRNum(o.totalSize),
    filled: parseIBKRNum(o.filledQuantity),
    // Stop orders keep their trigger in auxPrice/stop_price, not price.
    price: parseIBKRNum(o.price ?? o.auxPrice ?? o.stop_price ?? o.stopPrice ?? o.avgPrice),
    status: mapStatus(o.status),
    rawStatus: o.status,
    time: new Date(o.lastExecutionTime_r ?? Date.now()).toLocaleTimeString(
      "en-US",
      { hour: "2-digit", minute: "2-digit" }
    ),
  }));
}

// The gateway answers order submissions with one or more confirmation
// questions ("You are about to place a market order...", price-cap warnings,
// etc). Each must be confirmed via /iserver/reply/{id} or the order is
// silently dropped — without this loop NOTHING ever reaches IBKR.
async function submitOrders(orders: Record<string, unknown>[]) {
  let response: any = await ibkr(
    `/iserver/account/${CURRENT_ACCOUNT}/orders`,
    { method: "POST", body: JSON.stringify({ orders }) }
  );

  for (let i = 0; i < 8; i++) {
    const first = Array.isArray(response) ? response[0] : response;
    if (!first) throw new Error("Empty response from IBKR order endpoint");

    if (first.order_id) {
      return {
        orderId: String(first.order_id),
        status: (first.order_status ?? "Submitted") as string,
      };
    }
    if (first.error) throw new Error(String(first.error));
    if (first.id) {
      // Confirmation question → answer yes and re-inspect.
      response = await ibkr(`/iserver/reply/${first.id}`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
      });
      continue;
    }
    throw new Error(`Unexpected IBKR order response: ${JSON.stringify(first).slice(0, 200)}`);
  }
  throw new Error("Order not confirmed after 8 attempts");
}

export interface PlaceOrderParams {
  symbol: string;
  /** Trade this exact contract (e.g. an option conid) instead of resolving the stock symbol. */
  conid?: number;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MKT" | "LMT" | "STP";
  /** Limit price (LMT) or stop trigger price (STP). */
  price?: number;
  /** Optional bracket: fixed stop-loss trigger for the opposite side. */
  stopLoss?: number;
  /**
   * Optional bracket: TRAILING stop-loss as a percent. The stop follows the
   * price as it moves in your favor (locking in profit) and only triggers on a
   * pullback of this size. Takes precedence over the fixed stopLoss.
   */
  trailingStopPct?: number;
  /** Optional bracket: take-profit limit for the opposite side. */
  takeProfit?: number;
  tif?: "DAY" | "GTC";
}

export async function placeOrder(params: PlaceOrderParams) {
  const { symbol, side, quantity, orderType, price, stopLoss, trailingStopPct, takeProfit } = params;
  if (!quantity || quantity <= 0) throw new Error("Quantity must be positive");
  if ((orderType === "LMT" || orderType === "STP") && !price) {
    throw new Error(`${orderType} orders need a price`);
  }

  const conid = params.conid ?? (await getConid(symbol));
  if (!conid) throw new Error(`Symbol ${symbol} not found at IBKR`);

  const cOID = `nova-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const closeSide = side === "BUY" ? "SELL" : "BUY";

  const orders: Record<string, unknown>[] = [
    {
      acctId: CURRENT_ACCOUNT,
      conid,
      cOID,
      orderType,
      side,
      quantity,
      tif: params.tif ?? "DAY",
      // LMT: price = limit. STP: price = stop trigger.
      ...(orderType !== "MKT" ? { price } : {}),
    },
  ];

  // Bracket children reference the parent via parentId=cOID so they activate
  // only when the parent fills and cancel each other (OCA) at IBKR.
  if (trailingStopPct && trailingStopPct > 0) {
    // Trailing stop: follows the price by trailingStopPct% as it moves in the
    // position's favor, so profit gets locked in instead of round-tripping.
    orders.push({
      acctId: CURRENT_ACCOUNT,
      conid,
      parentId: cOID,
      orderType: "TRAIL",
      side: closeSide,
      quantity,
      trailingAmt: trailingStopPct,
      trailingType: "%",
      tif: "GTC",
    });
  } else if (stopLoss) {
    orders.push({
      acctId: CURRENT_ACCOUNT,
      conid,
      parentId: cOID,
      orderType: "STP",
      side: closeSide,
      quantity,
      price: stopLoss,
      tif: "GTC",
    });
  }
  if (takeProfit) {
    orders.push({
      acctId: CURRENT_ACCOUNT,
      conid,
      parentId: cOID,
      orderType: "LMT",
      side: closeSide,
      quantity,
      price: takeProfit,
      tif: "GTC",
    });
  }

  const result = await submitOrders(orders);
  invalidatePositionsCache();
  return result;
}

/** Close an open position with a market order on the opposite side. */
/**
 * Cancel every WORKING order that matches the symbol and/or conid. Crucial
 * before manually closing a position: leftover GTC bracket children (stop /
 * take-profit) stay live at IBKR after the position is flat and would execute
 * later — flipping you into an unintended short.
 */
export async function cancelWorkingOrders(filter: { symbol?: string; conid?: number }) {
  const orders = await getOrders().catch(() => []);
  const targets = orders.filter(
    (o) =>
      o.status === "Working" &&
      ((filter.conid && o.conid === filter.conid) ||
        (filter.symbol && o.symbol?.toUpperCase() === filter.symbol.toUpperCase()))
  );
  let cancelled = 0;
  for (const o of targets) {
    try {
      await cancelOrder(String(o.orderId));
      cancelled++;
    } catch {
      /* keep going — closing the position matters more */
    }
  }
  return cancelled;
}

export async function closePosition(conid: number, quantity: number) {
  if (!quantity) throw new Error("Nothing to close");
  // Kill any working orders on this contract first (see cancelWorkingOrders).
  await cancelWorkingOrders({ conid }).catch(() => {});
  const result = await submitOrders([
    {
      acctId: CURRENT_ACCOUNT,
      conid,
      orderType: "MKT",
      side: quantity > 0 ? "SELL" : "BUY",
      quantity: Math.abs(quantity),
      tif: "DAY",
    },
  ]);
  invalidatePositionsCache();
  return result;
}

export interface Trade {
  executionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  time: number;
  commission: number;
  netAmount: number;
  orderRef: string;
}

/** Executed trades for the last few days (IBKR keeps ~1 week). */
export async function getTrades(days = 6): Promise<Trade[]> {
  const data = await ibkr<any[]>(`/iserver/account/trades?days=${days}`);
  return (data ?? []).map((t) => ({
    executionId: String(t.execution_id ?? t.exec_id ?? ""),
    symbol: t.symbol ?? t.ticker ?? t.contract_description_1 ?? "",
    side: t.side === "B" || t.side === "BUY" ? ("BUY" as const) : ("SELL" as const),
    quantity: parseIBKRNum(t.size),
    price: parseIBKRNum(t.price),
    time: typeof t.trade_time_r === "number" ? t.trade_time_r : Date.parse(t.trade_time ?? "") || 0,
    commission: parseIBKRNum(t.commission),
    netAmount: parseIBKRNum(t.net_amount),
    orderRef: String(t.order_ref ?? ""),
  }));
}

export async function cancelOrder(orderId: string) {
  return ibkr<any>(
    `/iserver/account/${CURRENT_ACCOUNT}/order/${orderId}`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

// Snapshot fields: 31 last, 55 symbol, 70 high, 71 low, 82 change,
// 83 change %, 84 bid, 86 ask, 87 volume (formatted), 7295 open,
// 7741 prior close, 7762 volume (raw long).
// NOTE: field 7296 is "today's close" (empty during the session); the actual
// previous-day close is field 7741.
const SNAPSHOT_FIELDS = "31,55,70,71,82,83,84,86,87,7295,7741,7762";

const SUBSCRIBED_CONIDS = new Set<number>();

export interface Snapshot {
  conid: number;
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  volume: number;
  updated: number;
}

export async function getMarketSnapshot(conids: number[]): Promise<Snapshot[]> {
  if (conids.length === 0) return [];
  const newConids = conids.filter((id) => !SUBSCRIBED_CONIDS.has(id));

  if (newConids.length > 0) {
    // First call only opens the subscription; data arrives on the next one.
    await ibkr<any[]>(
      `/iserver/marketdata/snapshot?conids=${newConids.join(",")}&fields=${SNAPSHOT_FIELDS}`
    ).catch(() => []);
    newConids.forEach((id) => SUBSCRIBED_CONIDS.add(id));
    await new Promise((r) => setTimeout(r, 600));
  }

  try {
    const data = await ibkr<any[]>(
      `/iserver/marketdata/snapshot?conids=${conids.join(",")}&fields=${SNAPSHOT_FIELDS}`
    );
    return (data ?? []).map((d) => {
      const last = parseIBKRNum(d["31"]);
      const change = parseIBKRNum(d["82"]);
      // Prefer field 7741 (prior close); fall back to last - change.
      const prevClose = parseIBKRNum(d["7741"]) || (last && change ? last - change : 0);
      return {
        conid: d.conid,
        symbol: d["55"] ?? "",
        last,
        change,
        changePct: parseIBKRNum(d["83"]),
        bid: parseIBKRNum(d["84"]),
        ask: parseIBKRNum(d["86"]),
        high: parseIBKRNum(d["70"]),
        low: parseIBKRNum(d["71"]),
        open: parseIBKRNum(d["7295"]),
        prevClose,
        volume: d["7762"] ? parseIBKRNum(d["7762"]) : parseVolume(d["87"]),
        updated: d["_updated"] ?? 0,
      };
    });
  } catch (error) {
    console.warn("Market snapshot failed:", error);
    return [];
  }
}

export interface SymbolQuote extends Snapshot {
  symbol: string;
}

/** Live quotes for a list of symbols (conids resolved automatically). */
export async function getQuotes(symbols: string[]): Promise<SymbolQuote[]> {
  const map = await resolveConids(symbols);
  const entries = Object.entries(map);
  if (entries.length === 0) return [];
  const bySymbol = new Map(entries.map(([sym, conid]) => [conid, sym]));
  const snaps = await getMarketSnapshot(entries.map(([, conid]) => conid));
  return snaps.map((s) => ({ ...s, symbol: bySymbol.get(s.conid) ?? s.symbol }));
}

export interface ChartBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  time: string;
}

export async function getChartData(conid: number, period = "1d", bar = "5min"): Promise<ChartBar[]> {
  try {
    const data = await ibkr<any>(
      `/iserver/marketdata/history?conid=${conid}&period=${period}&bar=${bar}&outsideRth=false`
    );
    return (data?.data ?? []).map((d: any) => ({
      t: d.t,
      o: parseIBKRNum(d.o),
      h: parseIBKRNum(d.h),
      l: parseIBKRNum(d.l),
      c: parseIBKRNum(d.c),
      v: parseIBKRNum(d.v),
      time: new Date(d.t).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
  } catch (error) {
    console.warn("Chart data failed:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Options (F&O) — real IBKR option chain
// ---------------------------------------------------------------------------

export interface OptionMeta {
  conid: number;
  months: string[]; // e.g. ["JUL26","AUG26",...]
}

/** Underlying conid + available option months for a stock/ETF symbol. */
export async function getOptionMeta(symbol: string): Promise<OptionMeta | null> {
  const res = await ibkr<any[]>(
    `/iserver/secdef/search?symbol=${encodeURIComponent(symbol.trim().toUpperCase())}`
  );
  const row = (res ?? []).find(
    (r) => Number(r.conid) > 0 && (r.sections ?? []).some((s: any) => s.secType === "OPT")
  );
  if (!row) return null;
  const sec = row.sections.find((s: any) => s.secType === "OPT");
  const months =
    typeof sec?.months === "string" ? sec.months.split(";").filter(Boolean) : [];
  return { conid: Number(row.conid), months };
}

export interface OptionContract {
  conid: number;
  strike: number;
  right: "C" | "P";
  maturityDate: string; // YYYYMMDD
}

async function optionInfo(
  underlying: number,
  month: string,
  right: "C" | "P",
  strike: number
): Promise<OptionContract[]> {
  const res = await ibkr<any>(
    `/iserver/secdef/info?conid=${underlying}&sectype=OPT&month=${month}&exchange=SMART&strike=${strike}&right=${right}`
  );
  const arr = Array.isArray(res) ? res : res ? [res] : [];
  return arr
    .filter((o) => Number(o.conid) > 0)
    .map((o) => ({
      conid: Number(o.conid),
      strike: Number(o.strike ?? strike),
      right,
      maturityDate: String(o.maturityDate ?? ""),
    }));
}

// Contract ids for a given (underlying, month, strike, right) are stable for the
// life of the listing, so we cache the resolved conids per (underlying:month).
// This is what makes the chain SLOW on first open (one /secdef/info round-trip
// per strike×right) but INSTANT on every re-open — the cache survives reloads.
const OPTCHAIN_KEY = "nova_optchain_v1";
const OPTCHAIN_TTL = 12 * 60 * 60 * 1000; // 12h
type ChainCacheEntry = { ts: number; byStrike: Record<string, OptionContract[]> };
const optChainMem = new Map<string, ChainCacheEntry>();

function loadOptChain(key: string): ChainCacheEntry | null {
  const mem = optChainMem.get(key);
  if (mem) return Date.now() - mem.ts < OPTCHAIN_TTL ? mem : null;
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(OPTCHAIN_KEY) ?? "{}");
    const e = all[key] as ChainCacheEntry | undefined;
    if (e && Date.now() - e.ts < OPTCHAIN_TTL) { optChainMem.set(key, e); return e; }
  } catch { /* corrupt cache — ignore */ }
  return null;
}

function saveOptChain(key: string, entry: ChainCacheEntry) {
  optChainMem.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(OPTCHAIN_KEY) ?? "{}");
    all[key] = entry;
    // keep only the 20 most-recent underlyings so the cache can't grow unbounded
    const keys = Object.keys(all).sort((a, b) => (all[b]?.ts ?? 0) - (all[a]?.ts ?? 0));
    const pruned: Record<string, ChainCacheEntry> = {};
    for (const k of keys.slice(0, 20)) pruned[k] = all[k];
    localStorage.setItem(OPTCHAIN_KEY, JSON.stringify(pruned));
  } catch { /* quota — ignore */ }
}

/** All listed strikes for one option month (one fast round-trip). */
export async function getOptionStrikes(conid: number, month: string): Promise<number[]> {
  const st = await ibkr<{ call?: number[]; put?: number[] }>(
    `/iserver/secdef/strikes?conid=${conid}&sectype=OPT&month=${month}&exchange=SMART`
  );
  return (st?.call ?? []).slice().sort((a, b) => a - b);
}

/** The `span·2+1` strikes nearest `spot` (or the middle of the list if spot=0). */
export function pickNearestStrikes(all: number[], spot: number, span = 6): number[] {
  if (!all.length) return [];
  if (spot <= 0) {
    const mid = Math.floor(all.length / 2);
    return all.slice(Math.max(0, mid - span), mid + span + 1);
  }
  return [...new Set(
    [...all].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, span * 2 + 1)
  )].sort((a, b) => a - b);
}

/**
 * Resolve call+put contract ids for the requested strikes of one month, using
 * the per-underlying cache. Only strikes NOT already cached hit the gateway, so
 * scrolling / re-opening the chain costs nothing. Weekly expiries included.
 */
export async function resolveOptionContracts(
  conid: number,
  month: string,
  strikes: number[]
): Promise<OptionContract[]> {
  const key = `${conid}:${month}`;
  const cached = loadOptChain(key);
  const byStrike: Record<string, OptionContract[]> = { ...(cached?.byStrike ?? {}) };
  const missing = strikes.filter((k) => !byStrike[String(k)]);

  if (missing.length) {
    const CHUNK = 6; // parallel round-trips per batch — fast but not a flood
    for (let i = 0; i < missing.length; i += CHUNK) {
      const batch = missing.slice(i, i + CHUNK);
      const results = await Promise.all(
        batch.flatMap((k) => [
          optionInfo(conid, month, "C", k).catch(() => [] as OptionContract[]),
          optionInfo(conid, month, "P", k).catch(() => [] as OptionContract[]),
        ])
      );
      batch.forEach((k, bi) => {
        byStrike[String(k)] = [...(results[bi * 2] ?? []), ...(results[bi * 2 + 1] ?? [])];
      });
    }
    saveOptChain(key, { ts: Date.now(), byStrike });
  }
  return strikes.flatMap((k) => byStrike[String(k)] ?? []);
}

/**
 * Option chain for one month: the `span·2+1` strikes nearest the spot, with the
 * call+put contract ids for every expiry inside that month (weeklies included).
 * Cached per underlying so only the first open is slow.
 */
export async function getOptionChain(
  underlying: number,
  month: string,
  spot: number,
  span = 6
): Promise<{ strikes: number[]; contracts: OptionContract[] }> {
  const all = await getOptionStrikes(underlying, month);
  if (!all.length) return { strikes: [], contracts: [] };
  const picked = pickNearestStrikes(all, spot, span);
  const contracts = await resolveOptionContracts(underlying, month, picked);
  return { strikes: picked, contracts };
}

/**
 * Pick the single best option contract to express a directional signal:
 * the strike just in-the-money (C: below spot, P: above spot) with an expiry
 * 7–35 days out (enough time to be right, not bleeding theta on a 0DTE).
 */
export async function findOptionPlay(
  symbol: string,
  right: "C" | "P",
  spot: number
): Promise<(OptionContract & { underlyingConid: number }) | null> {
  const meta = await getOptionMeta(symbol);
  if (!meta || spot <= 0) return null;
  for (const month of meta.months.slice(0, 2)) {
    try {
      const st = await ibkr<{ call?: number[] }>(
        `/iserver/secdef/strikes?conid=${meta.conid}&sectype=OPT&month=${month}&exchange=SMART`
      );
      const strikes = st?.call ?? [];
      if (!strikes.length) continue;
      const itm =
        right === "C"
          ? [...strikes].filter((k) => k <= spot).sort((a, b) => b - a)[0]
          : [...strikes].filter((k) => k >= spot).sort((a, b) => a - b)[0];
      const strike = itm ?? [...strikes].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0];
      const infos = await optionInfo(meta.conid, month, right, strike);
      const now = Date.now();
      const inWindow = infos
        .map((c) => ({
          c,
          days: (new Date(
            `${c.maturityDate.slice(0, 4)}-${c.maturityDate.slice(4, 6)}-${c.maturityDate.slice(6, 8)}T21:00:00Z`
          ).getTime() - now) / 86_400_000,
        }))
        .filter((x) => x.days >= 7 && x.days <= 35)
        .sort((a, b) => a.days - b.days);
      if (inWindow[0]) return { ...inWindow[0].c, underlyingConid: meta.conid };
    } catch {
      /* try next month */
    }
  }
  return null;
}

export interface OptionQuote {
  conid: number;
  last: number;
  bid: number;
  ask: number;
  changePct: number;
  volume: number;
  iv: number;    // implied volatility %
  delta: number;
  theta: number;
}

// 7283 implied vol, 7308 delta, 7310 theta (CP snapshot field ids)
const OPTION_FIELDS = "31,84,86,82,83,87,7283,7308,7310";

/** Live quotes + greeks for option conids (same subscribe-then-read dance). */
export async function getOptionQuotes(conids: number[]): Promise<OptionQuote[]> {
  if (!conids.length) return [];
  const fresh = conids.filter((id) => !SUBSCRIBED_CONIDS.has(id));
  if (fresh.length) {
    await ibkr<any[]>(
      `/iserver/marketdata/snapshot?conids=${fresh.join(",")}&fields=${OPTION_FIELDS}`
    ).catch(() => []);
    fresh.forEach((id) => SUBSCRIBED_CONIDS.add(id));
    await new Promise((r) => setTimeout(r, 700));
  }
  try {
    const data = await ibkr<any[]>(
      `/iserver/marketdata/snapshot?conids=${conids.join(",")}&fields=${OPTION_FIELDS}`
    );
    const pctNum = (v: unknown) => parseIBKRNum(String(v ?? "").replace("%", ""));
    return (data ?? []).map((d) => ({
      conid: d.conid,
      last: parseIBKRNum(d["31"]),
      bid: parseIBKRNum(d["84"]),
      ask: parseIBKRNum(d["86"]),
      changePct: parseIBKRNum(d["83"]),
      volume: parseVolume(d["87"]),
      iv: pctNum(d["7283"]),
      delta: parseIBKRNum(d["7308"]),
      theta: parseIBKRNum(d["7310"]),
    }));
  } catch {
    return [];
  }
}
