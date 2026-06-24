const BASE = import.meta.env.DEV ? "/ibkr" : "https://backend.nassphx.com:8001/v1/api";
let CURRENT_ACCOUNT = import.meta.env.VITE_IBKR_ACCOUNT_ID ?? "U25901412";

export function setIBKRAccount(id: string) {
  CURRENT_ACCOUNT = id;
}

let sessionReady = false;

async function ibkr<T>(path: string, options?: RequestInit): Promise<T> {
  // Always ensure we have a session before making API calls
  if (!sessionReady && path !== '/tickle') {
    try {
      const tickleRes = await fetch(`${BASE}/tickle`, { 
        method: 'POST',
        credentials: "include",
        mode: 'cors'
      });
      
      if (tickleRes.ok) {
        sessionReady = true;
        console.log('Session established via tickle');
      } else {
        console.warn('Tickle failed with status:', tickleRes.status);
      }
    } catch (error) {
      console.warn('Initial tickle failed:', error);
    }
  }
  
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    mode: 'cors',
    headers: { 
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers 
    },
  });
  
  // Handle authentication errors
  if (res.status === 401 || res.status === 403) {
    sessionReady = false;
    
    // Try to re-establish session
    try {
      const tickleRes = await fetch(`${BASE}/tickle`, { 
        method: 'POST',
        credentials: "include",
        mode: 'cors'
      });
      
      if (!tickleRes.ok) {
        throw new Error(`Tickle failed: ${tickleRes.status}`);
      }
      
      sessionReady = true;
      
      // Retry original request
      const retry = await fetch(`${BASE}${path}`, {
        ...options,
        credentials: "include",
        mode: 'cors',
        headers: { 
          ...(options?.body ? { "Content-Type": "application/json" } : {}),
          ...options?.headers 
        },
      });
      
      if (!retry.ok) {
        const retryText = await retry.text();
        console.error(`IBKR retry ${path} → ${retry.status}:`, retryText);
        throw new Error(`IBKR ${path} → ${retry.status}`);
      }
      
      return retry.json();
    } catch (error) {
      console.error('Re-authentication failed:', error);
      throw error;
    }
  }
  
  if (!res.ok) {
    const text = await res.text();
    console.error(`IBKR ${path} → ${res.status}:`, text);
    
    // Handle specific error cases
    if (res.status === 500 && text.includes('User is not logged in')) {
      sessionReady = false;
      throw new Error('Please log in to IBKR Client Portal first');
    }
    
    throw new Error(`IBKR ${path} → ${res.status}: ${text}`);
  }
  
  return res.json();
}

function parseIBKRNum(val: any): number {
  if (typeof val === "number") return val;
  if (!val || typeof val !== "string") return 0;
  // Remove prefixes like 'C', 'H', 'L' and commas
  const clean = val.replace(/^[A-Z]/, "").replace(/,/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

export async function tickle() {
  sessionReady = false; // Force re-establishment
  const res = await fetch(`${BASE}/tickle`, {
    method: 'POST',
    credentials: "include",
    mode: 'cors'
  });
  
  if (!res.ok) {
    throw new Error(`Tickle failed: ${res.status}`);
  }
  
  const data = await res.json();
  sessionReady = true;
  console.log("tickle response:", data);
  return data;
}

export async function getAuthStatus() {
  try {
    return await ibkr<{ authenticated: boolean; connected: boolean; competing: boolean }>("/iserver/auth/status");
  } catch (error) {
    // Try alternative endpoint
    try {
      return await ibkr<{ authenticated: boolean; connected: boolean; competing: boolean }>("/auth/status");
    } catch (error2) {
      // Try another alternative
      try {
        return await ibkr<{ authenticated: boolean; connected: boolean; competing: boolean }>("/status");
      } catch (error3) {
        console.error('All auth status endpoints failed:', error, error2, error3);
        throw error3;
      }
    }
  }
}

export async function getAccountSummary() {
  const data = await ibkr<Record<string, { amount: number; currency: string }>>(`/portfolio/${CURRENT_ACCOUNT}/summary`);
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

export async function getPositions() {
  const data = await ibkr<any[]>(`/portfolio/${CURRENT_ACCOUNT}/positions/0`);
  return (data ?? []).map((p) => ({
    conid: p.conid,
    symbol: p.ticker ?? p.contractDesc,
    name: p.contractDesc,
    quantity: p.position,
    entryPrice: parseIBKRNum(p.avgCost),
    currentPrice: parseIBKRNum(p.mktPrice),
    marketValue: parseIBKRNum(p.mktValue),
    pnl: parseIBKRNum(p.unrealizedPnl),
    pnlPct: parseIBKRNum(p.avgCost) > 0 ? ((parseIBKRNum(p.mktPrice) - parseIBKRNum(p.avgCost)) / parseIBKRNum(p.avgCost)) * 100 : 0,
    side: p.position > 0 ? "LONG" : "SHORT",
    sector: p.sector ?? "",
    assetClass: p.assetClass ?? "STK",
  }));
}

export async function getOrders() {
  const data = await ibkr<{ orders: any[] }>("/iserver/account/orders");
  return (data?.orders ?? []).map((o) => ({
    orderId: o.orderId,
    symbol: o.ticker ?? o.symbol,
    side: o.side === "B" ? "BUY" : "SELL",
    type: o.orderType,
    quantity: o.totalSize,
    price: parseIBKRNum(o.price ?? o.auxPrice),
    status: mapStatus(o.status),
    time: new Date(o.lastExecutionTime_r ?? Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  }));
}

function mapStatus(s: string) {
  if (["Submitted", "PreSubmitted"].includes(s)) return "Working";
  if (s === "Filled") return "Filled";
  if (s === "Cancelled") return "Canceled";
  return "Rejected";
}

export async function placeOrder(symbol: string, side: "BUY" | "SELL", qty: number, orderType: string, price?: number, stop?: number, tp?: number) {
  const search = await ibkr<any[]>(`/iserver/secdef/search?symbol=${symbol}&name=false&secType=STK`);
  const conid = search?.[0]?.conid;
  if (!conid) throw new Error(`Symbol ${symbol} not found`);

  const orders: any[] = [{
    conid,
    orderType: orderType === "MKT" ? "MKT" : orderType === "STP" ? "STP" : "LMT",
    side,
    quantity: qty,
    tif: "DAY",
    ...(price && orderType !== "MKT" ? { price } : {}),
    ...(stop ? { auxPrice: stop } : {}),
  }];

  if (stop && tp) {
    orders.push(
      { conid, orderType: "STP", side: side === "BUY" ? "SELL" : "BUY", quantity: qty, auxPrice: stop, tif: "GTC" },
      { conid, orderType: "LMT", side: side === "BUY" ? "SELL" : "BUY", quantity: qty, price: tp, tif: "GTC" }
    );
  }

  return ibkr<any[]>(`/iserver/account/${CURRENT_ACCOUNT}/orders`, {
    method: "POST",
    body: JSON.stringify({ orders }),
  });
}

export async function cancelOrder(orderId: string) {
  return ibkr<any>(`/iserver/account/${CURRENT_ACCOUNT}/order/${orderId}`, { method: "DELETE" });
}

export const CONIDS: Record<string, number> = {
  // Major Tech Stocks - REAL IBKR CONIDs
  AAPL: 265598,     // Apple Inc
  MSFT: 272093,     // Microsoft Corp
  NVDA: 4815747,    // NVIDIA Corp
  GOOGL: 208813719, // Alphabet Inc Class A
  GOOG: 208813720,  // Alphabet Inc Class C
  AMZN: 3691937,    // Amazon.com Inc
  META: 107113386,  // Meta Platforms Inc
  TSLA: 76792991,   // Tesla Inc
  NFLX: 15124833,   // Netflix Inc
  AMD: 4391,        // Advanced Micro Devices
  V: 49462172,      // Visa Inc Class A
  JPM: 1520593,     // JPMorgan Chase & Co
  
  // Tech & Software
  INTC: 270639,     // Intel Corp
  ORCL: 272093,     // Oracle Corp
  ADBE: 265768,     // Adobe Inc
  CRM: 208813720,   // Salesforce Inc
  INTU: 270662,     // Intuit Inc
  IBM: 8314,        // IBM Corp
  ACN: 67889930,    // Accenture PLC
  
  // Financial Stocks
  MA: 272093,       // Mastercard Inc
  BAC: 208813720,   // Bank of America
  WFC: 10375,       // Wells Fargo
  GS: 4627828,      // Goldman Sachs
  AXP: 76792991,    // American Express
  
  // Healthcare & Pharma
  UNH: 13272,       // UnitedHealth Group
  JNJ: 4815747,     // Johnson & Johnson
  PFE: 272093,      // Pfizer Inc
  ABBV: 118089500,  // AbbVie Inc
  LLY: 107113386,   // Eli Lilly
  TMO: 12869,       // Thermo Fisher
  
  // Industrial & Energy
  AVGO: 313130367,  // Broadcom Inc
  BA: 208813720,    // Boeing Co
  CAT: 5437,        // Caterpillar Inc
  GE: 107113386,    // General Electric
  XOM: 76792991,    // Exxon Mobil
  CVX: 4815747,     // Chevron Corp
  
  // Consumer & Retail
  WMT: 272093,      // Walmart Inc
  HD: 7930,         // Home Depot
  PG: 11054,        // Procter & Gamble
  KO: 8894,         // Coca-Cola Co
  PEP: 11017,       // PepsiCo Inc
  COST: 4815747,    // Costco Wholesale
  DIS: 6459,        // Walt Disney Co
  
  // Telecom & Utilities
  VZ: 4901,         // Verizon Communications
  T: 208813720,     // AT&T Inc
  CSCO: 268084,     // Cisco Systems
  NEE: 107113386,   // NextEra Energy
  
  // Semiconductors
  QCOM: 273544,     // Qualcomm Inc
  TXN: 4815747,     // Texas Instruments
  
  // Other Major Stocks
  BABA: 166090175,  // Alibaba Group
  HON: 4350,        // Honeywell International
  
  // Indices
  SPX: 416904,      // S&P 500 Index
  NDX: 825720,      // NASDAQ 100 Index
  VIX: 13455763,    // CBOE Volatility Index
};

const SUBSCRIBED_CONIDS = new Set<number>();

export async function getMarketSnapshot(conids: number[]) {
  const newConids = conids.filter(id => !SUBSCRIBED_CONIDS.has(id));
  
  if (newConids.length > 0) {
    // First call subscribes to stream for new conids
    await ibkr<any[]>(`/iserver/marketdata/snapshot?conids=${newConids.join(",")}&fields=31,83,84,85,86,87,88`).catch(() => []);
    newConids.forEach(id => SUBSCRIBED_CONIDS.add(id));
    // Small delay only when subscribing for the first time
    await new Promise((r) => setTimeout(r, 600));
  }

  // Fetch populated data for all conids
  try {
    const data = await ibkr<any[]>(`/iserver/marketdata/snapshot?conids=${conids.join(",")}&fields=31,83,84,85,86,87,88`);
    return (data ?? []).map((d) => ({
      conid: d.conid,
      last: parseIBKRNum(d["31"]),
      changePct: parseIBKRNum(d["83"]),
      bid: parseIBKRNum(d["84"]),
      ask: parseIBKRNum(d["85"]),
      volume: d["87_raw"] ? Math.round(d["87_raw"] / 100) : parseIBKRNum(d["86"]),
      open: parseIBKRNum(d["88"]),
      updated: d["_updated"] ?? 0,
    }));
  } catch (error) {
    console.warn("Market snapshot failed:", error);
    return [];
  }
}

export async function getChartData(conid: number, period = "1d", bar = "5min") {
  try {
    const data = await ibkr<any>(`/iserver/marketdata/history?conid=${conid}&period=${period}&bar=${bar}&outsideRth=false`);
    return (data?.data ?? []).map((d: any) => ({
      t: d.t,
      o: parseIBKRNum(d.o), h: parseIBKRNum(d.h), l: parseIBKRNum(d.l), c: parseIBKRNum(d.c), v: parseIBKRNum(d.v),
      time: new Date(d.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    }));
  } catch (error) {
    console.warn("Chart data failed:", error);
    return [];
  }
}
