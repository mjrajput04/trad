// NOVA Engine — server-side intraday "Stocks in Play" trader (PM2: nova-engine).
//
// Strategy (validated in the 5-min lab, Oct 2026 — see ENGINE_NOTES below):
//   09:36 ET  IBKR scanners (gappers, % movers, hot-by-volume, most active) →
//             liquid US stocks; keep those with relative volume of the first
//             5-min bar >= minRv (vs prior days) and an opening gap >= minGapPct.
//   09:45 ET  15-min opening range (09:30–09:45). Trade a stock only when its
//             gap, its own first 15 minutes AND SPY's first 15 minutes all point
//             the same way. Top N by relative volume, market entry.
//   Exits     stop = other side of the 15-min range; target = +targetUsd on the
//             position (quick profit); anything still open is flattened 15:55.
//   Guards    risk per trade in $, notional cap, daily loss limit (halts and
//             flattens), equity >= $25.5k for live (PDT), kill switch.
//
// Modes: off (scan only) · paper (simulated fills on live IBKR quotes) ·
//        live (real IBKR bracket orders: MKT entry + STP stop + LMT target).
//
// HTTP API on 127.0.0.1:ENGINE_PORT, exposed by nginx at /engine-api/. Every
// route except /health needs a Supabase access token of CONTROL_EMAIL.

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---- env (reuses admin-api's .env for SUPABASE_URL / SUPABASE_ANON) ----
const ENV_PATH = process.env.ENV_PATH || "/var/www/admin-api/.env";
try {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch (e) {
  console.error("cannot read env:", e.message);
}
const PORT = Number(process.env.ENGINE_PORT || 8066);
// Same as nova-mailer: go through ibkr-proxy (8002), not the raw gateway.
const GW = process.env.GW_URL || "http://127.0.0.1:8002/v1/api";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON;
const CONTROL_EMAIL = (process.env.CONTROL_EMAIL || "vivekvora32262@gmail.com").toLowerCase();
const DATA_DIR = process.env.ENGINE_DATA || path.join(__dirname, "data");
const JOURNAL_DIR = path.join(DATA_DIR, "journal");
fs.mkdirSync(JOURNAL_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Config + persisted state
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  riskUsd: 50,          // $ lost if the stop is hit (sizes the position)
  targetUsd: 30,        // $ profit taken per trade (lab-tested 20–50 at risk 50)
  topN: 5,              // max trades per day
  side: "both",         // both | long
  maxNotional: 12000,   // $ cap per position
  dailyLossLimit: 200,  // realized+open loss that halts the day and flattens
  minRv: 2,             // first-5-min volume vs its average
  minGapPct: 1,         // opening gap, % (same sign as the trade)
  minPrice: 5,
  minAtr: 0.5,
};
const LIMITS = {
  riskUsd: [10, 500], targetUsd: [5, 500], topN: [1, 10], maxNotional: [500, 50000],
  dailyLossLimit: [20, 3000], minRv: [1, 10], minGapPct: [0, 20], minPrice: [1, 1000], minAtr: [0, 20],
};
const ENTRY_MIN = 9 * 60 + 45;   // 09:45 ET decision
const ENTRY_LAST_MIN = ENTRY_MIN + 3; // give up on today's entries after 09:48
const SCAN_MIN = 9 * 60 + 36;    // first 5-min bar is complete
const FLAT_MIN = 15 * 60 + 55;
const LIVE_MIN_EQUITY = 25500;   // PDT line + buffer

const STATE_PATH = path.join(DATA_DIR, "state.json");
const state = {
  mode: "paper", // first boot paper-trades; LIVE is only ever armed by hand
  config: { ...DEFAULT_CONFIG },
  day: null,
  log: [],
};
try {
  const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  Object.assign(state, s, { config: { ...DEFAULT_CONFIG, ...(s.config || {}) } });
} catch (_) {}
// Never come back up in LIVE after a crash/restart — a human re-arms it.
if (state.mode === "live") state.mode = "paper";

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(STATE_PATH + ".tmp", JSON.stringify(state));
      fs.renameSync(STATE_PATH + ".tmp", STATE_PATH);
    } catch (e) {
      console.error("save:", e.message);
    }
  }, 300);
}

function log(level, msg) {
  const e = { t: Date.now(), level, msg };
  state.log.push(e);
  if (state.log.length > 300) state.log = state.log.slice(-300);
  console.log(`[${level}] ${msg}`);
  save();
}

// ---------------------------------------------------------------------------
// Time (US/Eastern)
// ---------------------------------------------------------------------------
const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", weekday: "short",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function et(d = new Date()) {
  const p = {};
  for (const x of ET_FMT.formatToParts(d)) p[x.type] = x.value;
  return { key: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute, sec: +p.second, wd: p.weekday };
}
// NYSE full holidays + early (13:00) closes, 2026–2027.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
const isTradingDay = (t) => !["Sat", "Sun"].includes(t.wd) && !HOLIDAYS.has(t.key);
const flatMinFor = (key) => (EARLY_CLOSE.has(key) ? 12 * 60 + 55 : FLAT_MIN);

// ---------------------------------------------------------------------------
// Gateway access
// ---------------------------------------------------------------------------
// `retry` re-sends on 429 (gateway pacing). Only for reads — never for orders.
async function gw(p, { method = "GET", body, timeout = 15000, retry = method === "GET" } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(GW + p, {
      method,
      headers: { "Content-Type": "application/json", "User-Agent": "nova-engine" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    if (r.status === 429 && retry && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = text; }
    if (!r.ok) {
      const e = new Error(`${r.status} ${p.split("?")[0]}: ${String(text).slice(0, 160)}`);
      e.status = r.status;
      throw e;
    }
    return j;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

// Small concurrency pool so the engine never hogs the shared gateway.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; }
    }
  }));
  return out;
}

let gwStatus = { ok: false, authenticated: false, checked: 0, account: null };
async function checkGateway() {
  try {
    const s = await gw("/iserver/auth/status", { method: "POST", timeout: 8000 });
    gwStatus.authenticated = !!s?.authenticated;
    gwStatus.ok = true;
    if (gwStatus.authenticated && !gwStatus.account) {
      const a = await gw("/iserver/accounts").catch((e) => { console.error("accounts:", e.message); return null; });
      gwStatus.account = a?.selectedAccount || a?.accounts?.[0] || null;
    }
  } catch (e) {
    gwStatus.ok = false;
    gwStatus.authenticated = false;
  }
  gwStatus.checked = Date.now();
  return gwStatus.authenticated;
}

// Snapshots: the first request for a conid only opens the subscription.
const subscribed = new Set();
const SNAP_FIELDS = "31,84,86,7295,7741,55";
async function snapshot(conids) {
  const ids = [...new Set(conids)].filter(Boolean);
  if (!ids.length) return new Map();
  const fresh = ids.filter((c) => !subscribed.has(c));
  for (let i = 0; i < fresh.length; i += 50) {
    await gw(`/iserver/marketdata/snapshot?conids=${fresh.slice(i, i + 50).join(",")}&fields=${SNAP_FIELDS}`).catch(() => null);
    fresh.slice(i, i + 50).forEach((c) => subscribed.add(c));
  }
  if (fresh.length) await sleep(800);
  const out = new Map();
  const read = async (list) => {
    for (let i = 0; i < list.length; i += 50) {
      const rows = await gw(`/iserver/marketdata/snapshot?conids=${list.slice(i, i + 50).join(",")}&fields=${SNAP_FIELDS}`).catch(() => []);
      for (const d of Array.isArray(rows) ? rows : []) {
        if (!(num(d["31"]) > 0)) continue;
        out.set(Number(d.conid), {
          last: num(d["31"]), bid: num(d["84"]), ask: num(d["86"]),
          open: num(d["7295"]), prevClose: num(d["7741"]), t: Date.now(),
        });
      }
    }
  };
  await read(ids);
  // A just-opened subscription often answers empty once; ask again for the gaps.
  const missing = ids.filter((c) => !out.has(c));
  if (missing.length) { await sleep(700); await read(missing); }
  return out;
}

// 5-min bars grouped by ET day.
async function bars5(conid, period) {
  const j = await gw(`/iserver/marketdata/history?conid=${conid}&period=${period}&bar=5min&outsideRth=false`, { timeout: 20000 });
  const days = new Map();
  for (const b of j?.data || []) {
    const t = et(new Date(b.t));
    if (t.min < 570 || t.min >= 960) continue;
    if (!days.has(t.key)) days.set(t.key, []);
    days.get(t.key).push({ m: t.min, o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v) });
  }
  for (const v of days.values()) v.sort((a, b) => a.m - b.m);
  return days;
}

// ---------------------------------------------------------------------------
// Day lifecycle
// ---------------------------------------------------------------------------
function newDay(key) {
  return {
    key, phase: "closed", scanned: false, decided: false, flattened: false,
    halted: false, haltReason: "", scanAt: 0, decideAt: 0,
    universe: 0, candidates: [], spy: null, positions: [], realized: 0, entryMode: null,
  };
}

function rollDay(t) {
  if (state.day && state.day.key === t.key) return;
  if (state.day) writeJournal(state.day);
  state.day = newDay(t.key);
  log("info", `new session ${t.key}`);
}

function writeJournal(day) {
  if (!day || !day.positions.length) return;
  const closed = day.positions.filter((p) => p.status === "closed");
  const wins = closed.filter((p) => p.pnl > 0).length;
  const summary = {
    key: day.key, mode: day.entryMode, trades: closed.length, wins,
    pnl: round2(closed.reduce((a, p) => a + p.pnl, 0)),
    positions: day.positions, candidates: day.candidates.slice(0, 30), haltReason: day.haltReason,
  };
  try { fs.writeFileSync(path.join(JOURNAL_DIR, `${day.key}.json`), JSON.stringify(summary)); } catch (e) { console.error(e); }
}

// ---------------------------------------------------------------------------
// 1) Scan — build today's "stocks in play" shortlist (09:36–09:44)
// ---------------------------------------------------------------------------
const ETF_RE = /\b(ETF|ETN|FUND|TRUST|PROSHARES|DIREXION|ISHARES|SPDR|INVESCO QQQ|LEVERAGED|INVERSE|ULTRA|BULL|BEAR|[0-9]X)\b/i;
const SCANS = ["HIGH_OPEN_GAP", "LOW_OPEN_GAP", "TOP_PERC_GAIN", "TOP_PERC_LOSE", "HOT_BY_VOLUME", "MOST_ACTIVE"];

let scanBusy = false;
async function scan() {
  if (scanBusy || Date.now() < (state.day.nextScanAt || 0)) return;
  scanBusy = true;
  const day = state.day;
  const cfg = state.config;
  try {
    // The 09:30 bar can take a few seconds to publish; retry until SPY has it.
    const spyToday = (await bars5(SPY_CONID, "1d")).get(day.key);
    if (!spyToday || !spyToday.length || spyToday[0].m !== 570) return;

    const uni = new Map();
    for (const type of SCANS) {
      const r = await gw("/iserver/scanner/run", {
        method: "POST",
        retry: true,
        body: {
          instrument: "STK", location: "STK.US.MAJOR", type,
          filter: [
            { code: "priceAbove", value: cfg.minPrice },
            { code: "avgVolumeAbove", value: 1000000 },
            { code: "marketCapAbove1e6", value: 500 },
          ],
        },
      }).catch((e) => { log("warn", `scanner ${type}: ${e.message}`); return null; });
      for (const c of r?.contracts || []) {
        const conid = Number(c.con_id || c.conidex);
        if (!conid || c.sec_type !== "STK" || ETF_RE.test(c.company_name || "")) continue;
        if (!uni.has(conid)) uni.set(conid, { conid, symbol: c.symbol, name: c.company_name || "", scans: [] });
        uni.get(conid).scans.push(type);
      }
      await sleep(1100); // scanner pacing: 1 req/s
    }
    day.universe = uni.size;
    if (!uni.size) { log("warn", "scanners returned nothing — retrying in 30s"); day.nextScanAt = Date.now() + 30000; return; }

    // Gap pre-filter from one snapshot pass, so history is fetched only for real gappers.
    const snaps = await snapshot([...uni.keys()]);
    const gappers = [...uni.values()].filter((u) => {
      const s = snaps.get(u.conid);
      if (!s || !s.open || !s.prevClose) return true; // unknown → let history decide
      return Math.abs(s.open / s.prevClose - 1) * 100 >= cfg.minGapPct;
    }).slice(0, 60);

    const rows = await pool(gappers, 2, async (u) => {
      const days = await bars5(u.conid, "2w");
      const today = days.get(day.key);
      if (!today || !today.length || today[0].m !== 570) return { ...u, skip: "no 09:30 bar" };
      const prior = [...days.keys()].filter((k) => k < day.key).sort();
      const firstVols = prior.map((k) => days.get(k)).filter((b) => b.length && b[0].m === 570).map((b) => b[0].v);
      if (firstVols.length < 5) return { ...u, skip: "short history" };
      const avg = firstVols.reduce((a, b) => a + b, 0) / firstVols.length;
      const rv = avg > 0 ? today[0].v / avg : 0;
      const prevDay = days.get(prior[prior.length - 1]);
      const prevClose = prevDay[prevDay.length - 1].c;
      // ATR from the daily ranges inside the 5-min history
      let trs = 0, n = 0, pc = null;
      for (const k of prior) {
        const b = days.get(k);
        const h = Math.max(...b.map((x) => x.h)), l = Math.min(...b.map((x) => x.l));
        if (pc != null) { trs += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); n++; }
        pc = b[b.length - 1].c;
      }
      const atr = n ? trs / n : 0;
      const open = today[0].o;
      const gapPct = prevClose ? (open / prevClose - 1) * 100 : 0;
      let skip = "";
      if (open < cfg.minPrice) skip = "price";
      else if (atr < cfg.minAtr) skip = "ATR";
      else if (rv < cfg.minRv) skip = `RV ${rv.toFixed(1)}`;
      else if (Math.abs(gapPct) < cfg.minGapPct) skip = `gap ${gapPct.toFixed(1)}%`;
      return { ...u, rv: round2(rv), gapPct: round2(gapPct), atr: round2(atr), open, prevClose, skip };
    });

    day.candidates = rows
      .filter((r) => r && !r.error && r.rv != null)
      .sort((a, b) => (a.skip ? 1 : 0) - (b.skip ? 1 : 0) || b.rv - a.rv)
      .slice(0, 60)
      .map((r) => ({ ...r, status: r.skip ? "filtered" : "watch", reason: r.skip || "" }));
    day.scanned = true;
    day.scanAt = Date.now();
    const live = day.candidates.filter((c) => c.status === "watch").length;
    log("info", `scan: ${uni.size} movers → ${gappers.length} gappers → ${live} in play (RV≥${cfg.minRv}, gap≥${cfg.minGapPct}%)`);
  } catch (e) {
    log("error", `scan failed: ${e.message}`);
  } finally {
    scanBusy = false;
    save();
  }
}

// ---------------------------------------------------------------------------
// 2) Decide — 15-min range + triple alignment, then enter (09:45)
// ---------------------------------------------------------------------------
const SPY_CONID = 756733;
function range15(days, key) {
  const b = (days.get(key) || []).filter((x) => x.m >= 570 && x.m < 585);
  if (b.length < 3 || b[0].m !== 570 || b[2].m !== 580) return null;
  return { h: Math.max(...b.map((x) => x.h)), l: Math.min(...b.map((x) => x.l)), o: b[0].o, c: b[2].c };
}

let decideBusy = false;
async function decide() {
  if (decideBusy) return;
  decideBusy = true;
  const day = state.day;
  const cfg = state.config;
  try {
    const spyDays = await bars5(SPY_CONID, "1d");
    const spy = range15(spyDays, day.key);
    if (!spy) return; // 09:40 bar not published yet → next tick retries
    const spyDir = Math.sign(spy.c - spy.o);
    day.spy = { dir: spyDir, o: spy.o, c: spy.c, chgPct: round2((spy.c / spy.o - 1) * 100) };

    // Only a stock whose gap points with SPY can qualify, so skip the others
    // without a history call; then walk by RV and stop once topN qualify.
    const watch = day.candidates.filter((c) => c.status === "watch");
    for (const c of watch) {
      if (Math.sign(c.gapPct) !== spyDir) { c.status = "filtered"; c.reason = "gap against SPY"; }
      else if (cfg.side === "long" && c.gapPct < 0) { c.status = "filtered"; c.reason = "short (long-only)"; }
    }
    const queue = watch.filter((c) => c.status === "watch").sort((a, b) => b.rv - a.rv);
    let qualified = 0;
    for (let i = 0; i < queue.length && qualified < cfg.topN; i += 2) {
      const res = await pool(queue.slice(i, i + 2), 2, async (c) => {
        try { return { c, r: range15(await bars5(c.conid, "1d"), day.key) }; } catch { return { c, r: null }; }
      });
      for (const { c, r } of res) {
        if (!r) { c.status = "filtered"; c.reason = "no 15m range"; continue; }
        c.dir = Math.sign(r.c - r.o);
        c.orH = r.h; c.orL = r.l;
        c.move15 = round2((r.c / r.o - 1) * 100);
        if (!c.dir) { c.status = "filtered"; c.reason = "flat 15m"; }
        else if (Math.sign(c.gapPct) !== c.dir) { c.status = "filtered"; c.reason = "15m against gap"; }
        else if (c.dir !== spyDir) { c.status = "filtered"; c.reason = "against SPY"; }
        else { c.status = "qualified"; qualified++; }
      }
    }
    queue.filter((c) => c.status === "watch").forEach((c) => { c.status = "filtered"; c.reason = `rank > top ${cfg.topN}`; });
    const picks = day.candidates.filter((c) => c.status === "qualified").sort((a, b) => b.rv - a.rv).slice(0, cfg.topN);
    day.candidates.filter((c) => c.status === "qualified" && !picks.includes(c)).forEach((c) => { c.status = "filtered"; c.reason = `rank > top ${cfg.topN}`; });
    day.decided = true;
    day.decideAt = Date.now();
    day.entryMode = state.mode;
    log("info", `09:45 SPY 15m ${day.spy.chgPct > 0 ? "+" : ""}${day.spy.chgPct}% → ${picks.length} pick(s): ${picks.map((p) => `${p.symbol}${p.dir > 0 ? "▲" : "▼"}`).join(" ") || "none"}`);

    if (state.mode === "off") { picks.forEach((p) => { p.status = "picked"; p.reason = "engine off"; }); return; }
    if (state.mode === "live") {
      const ok = await liveEquityOk();
      if (!ok) { picks.forEach((p) => { p.status = "picked"; p.reason = "live blocked (equity)"; }); return; }
    }
    const snaps = await snapshot(picks.map((p) => p.conid));
    for (const p of picks) {
      try { await enter(p, snaps.get(p.conid)); } catch (e) { p.status = "error"; p.reason = e.message.slice(0, 80); log("error", `${p.symbol} entry: ${e.message}`); }
    }
  } catch (e) {
    log("error", `decide failed: ${e.message}`);
  } finally {
    decideBusy = false;
    save();
  }
}

async function liveEquityOk() {
  try {
    const acct = gwStatus.account;
    const s = await gw(`/portfolio/${acct}/summary`);
    const nl = num(s?.netliquidation?.amount);
    if (nl < LIVE_MIN_EQUITY) { log("warn", `live blocked: net liquidation $${nl.toFixed(0)} < $${LIVE_MIN_EQUITY} (PDT)`); return false; }
    return true;
  } catch (e) {
    log("warn", `live blocked: cannot read account summary (${e.message})`);
    return false;
  }
}

function costs(sh, entry, exit, dir) {
  const comm = (px) => Math.min(Math.max(1, 0.005 * sh), 0.01 * sh * px);
  const sellPx = dir > 0 ? exit : entry;
  return comm(entry) + comm(exit) + 0.0000278 * sh * sellPx + Math.min(0.000166 * sh, 8.3);
}

async function enter(p, q) {
  const cfg = state.config;
  const day = state.day;
  const dir = p.dir;
  const ref = q ? (dir > 0 ? q.ask || q.last : q.bid || q.last) : 0;
  if (!(ref > 0)) throw new Error("no live quote");
  const stop = round2(dir > 0 ? p.orL : p.orH);
  let stopDist = dir > 0 ? ref - stop : stop - ref;
  if (stopDist <= 0) { p.status = "filtered"; p.reason = "price already past stop"; return; }
  stopDist = Math.max(stopDist, 0.02, 0.05 * (p.atr || 0));
  const qty = Math.min(Math.floor(cfg.riskUsd / stopDist), Math.floor(cfg.maxNotional / ref));
  if (qty < 1) { p.status = "filtered"; p.reason = "size < 1 share"; return; }
  const target = round2(ref + dir * Math.max(0.01, cfg.targetUsd / qty));
  const pos = {
    id: `eng-${day.key.replace(/-/g, "")}-${p.symbol}`,
    kind: state.mode, symbol: p.symbol, conid: p.conid, dir, qty,
    entry: null, ref: round2(ref), stop, target, riskUsd: round2(stopDist * qty),
    status: "pending", opened: Date.now(), closed: null, exit: null, why: "", pnl: 0, last: ref,
    orders: {},
  };
  // Track the position BEFORE submitting: if the submit errors half-way the
  // order may still exist at IBKR, and liveStep/flatten find it by cOID.
  day.positions.push(pos);
  if (state.mode === "paper") {
    pos.entry = round2(ref + dir * 0.01);
    pos.status = "open";
  } else {
    try {
      await placeBracket(pos);
    } catch (e) {
      pos.why = `submit error: ${e.message.slice(0, 60)}`;
      throw e;
    }
  }
  p.status = "entered";
  log("trade", `${pos.kind.toUpperCase()} ${dir > 0 ? "BUY" : "SHORT"} ${qty} ${p.symbol} @~${pos.ref} stop ${stop} target ${target} (risk $${pos.riskUsd})`);
}

// ---------------------------------------------------------------------------
// Live order plumbing (bracket at IBKR so protection survives an engine crash)
// ---------------------------------------------------------------------------
async function submit(orders) {
  let resp = await gw(`/iserver/account/${gwStatus.account}/orders`, { method: "POST", body: { orders } });
  for (let i = 0; i < 8; i++) {
    const first = Array.isArray(resp) ? resp[0] : resp;
    if (!first) throw new Error("empty order response");
    if (first.order_id) return Array.isArray(resp) ? resp : [resp];
    if (first.error) throw new Error(String(first.error));
    if (first.id) {
      resp = await gw(`/iserver/reply/${first.id}`, { method: "POST", body: { confirmed: true } });
      continue;
    }
    throw new Error(`unexpected order response ${JSON.stringify(first).slice(0, 160)}`);
  }
  throw new Error("order not confirmed");
}

async function placeBracket(pos) {
  if (!gwStatus.account) throw new Error("no IBKR account");
  const acctId = gwStatus.account;
  const side = pos.dir > 0 ? "BUY" : "SELL";
  const close = pos.dir > 0 ? "SELL" : "BUY";
  const cOID = `${pos.id}-${Date.now() % 100000}`;
  pos.orders = { parent: cOID, sl: `${cOID}-sl`, tp: `${cOID}-tp` };
  await submit([
    { acctId, conid: pos.conid, cOID, orderType: "MKT", side, quantity: pos.qty, tif: "DAY" },
    { acctId, conid: pos.conid, cOID: pos.orders.sl, parentId: cOID, orderType: "STP", side: close, quantity: pos.qty, price: pos.stop, tif: "DAY" },
    { acctId, conid: pos.conid, cOID: pos.orders.tp, parentId: cOID, orderType: "LMT", side: close, quantity: pos.qty, price: pos.target, tif: "DAY" },
  ]);
}

// Map our cOIDs → IBKR order rows. An empty or failed list during a session
// flap does NOT mean anything was cancelled, so nothing is concluded from it.
async function liveOrders() {
  const j = await gw("/iserver/account/orders").catch(() => null);
  const rows = j?.orders || [];
  const byRef = new Map();
  for (const o of rows) if (o.order_ref) byRef.set(o.order_ref, o);
  byRef.rows = rows;
  return byRef;
}

const TERMINAL = ["Filled", "Cancelled", "Inactive"];
// Bracket child by our cOID; if IBKR did not keep the child's ref, fall back to
// the same contract + closing side + order type.
function findChild(book, p, kind) {
  const byRef = book.get(kind === "sl" ? p.orders.sl : p.orders.tp);
  if (byRef) return byRef;
  const side = p.dir > 0 ? "SELL" : "BUY";
  const type = kind === "sl" ? /^stop/i : /^limit/i;
  return (book.rows || []).find((o) =>
    Number(o.conid) === p.conid && o.side === side && type.test(o.orderType || "") &&
    Number(o.totalSize || 0) === p.qty && o.order_ref !== p.orders.parent);
}

async function cancelOrder(orderId) {
  if (!orderId) return;
  await gw(`/iserver/account/${gwStatus.account}/order/${orderId}`, { method: "DELETE" }).catch((e) => log("warn", `cancel ${orderId}: ${e.message}`));
}

async function livePositionQty(conid) {
  const rows = await gw(`/portfolio/${gwStatus.account}/position/${conid}`).catch(() => null);
  const r = Array.isArray(rows) ? rows.find((x) => Number(x.conid) === conid) : null;
  return r ? num(r.position) : null;
}

// ---------------------------------------------------------------------------
// 3) Manage open positions (every ~2s)
// ---------------------------------------------------------------------------
let manageBusy = false;
async function manage() {
  if (manageBusy) return;
  manageBusy = true;
  const day = state.day;
  try {
    const open = day.positions.filter((p) => (p.status === "open" || p.status === "pending") && !p.closing);
    if (!open.length) return;
    const quotes = await snapshot(open.map((p) => p.conid));
    const live = open.some((p) => p.kind === "live") ? await liveOrders() : null;

    for (const p of open) {
      if (p.closing) continue; // a flatten/kill started while quotes were loading
      const q = quotes.get(p.conid);
      if (q && q.last > 0) p.last = q.last;
      if (p.kind === "paper") paperStep(p, q);
      else if (live) liveStep(p, live);
      if (p.status === "open" && p.entry) {
        p.pnl = round2(p.dir * (p.last - p.entry) * p.qty - costs(p.qty, p.entry, p.last, p.dir));
      }
    }
    day.realized = round2(day.positions.filter((p) => p.status === "closed").reduce((a, p) => a + p.pnl, 0));
    const openPnl = day.positions.filter((p) => p.status === "open").reduce((a, p) => a + p.pnl, 0);
    if (!day.halted && day.realized + openPnl <= -state.config.dailyLossLimit) {
      day.halted = true;
      day.haltReason = `daily loss limit −$${state.config.dailyLossLimit} hit`;
      log("warn", `${day.haltReason} — flattening`);
      await flattenAll("loss limit");
    }
  } catch (e) {
    log("error", `manage: ${e.message}`);
  } finally {
    manageBusy = false;
    save();
  }
}

function closePos(p, px, why) {
  p.exit = round2(px);
  p.why = why;
  p.status = "closed";
  p.closed = Date.now();
  p.last = p.exit;
  p.pnl = round2(p.dir * (p.exit - p.entry) * p.qty - costs(p.qty, p.entry, p.exit, p.dir));
  log("trade", `${p.kind.toUpperCase()} ${p.symbol} closed (${why}) @ ${p.exit} → ${p.pnl >= 0 ? "+" : "−"}$${Math.abs(p.pnl).toFixed(2)}`);
}

// Paper fills are deliberately pessimistic: stops fill one cent through,
// targets need the bid/ask to reach the level.
function paperStep(p, q) {
  if (!q || !(q.last > 0)) return;
  const bid = q.bid || q.last, ask = q.ask || q.last;
  if (p.dir > 0) {
    if (q.last <= p.stop || bid <= p.stop) return closePos(p, Math.min(p.stop, bid) - 0.01, "stop");
    if (bid >= p.target || q.last >= p.target + 0.01) return closePos(p, p.target, "target");
  } else {
    if (q.last >= p.stop || ask >= p.stop) return closePos(p, Math.max(p.stop, ask) + 0.01, "stop");
    if (ask <= p.target || q.last <= p.target - 0.01) return closePos(p, p.target, "target");
  }
}

function liveStep(p, byRef) {
  const parent = byRef.get(p.orders.parent);
  const sl = findChild(byRef, p, "sl");
  const tp = findChild(byRef, p, "tp");
  if (parent) p.orders.parentId = parent.orderId;
  if (sl) p.orders.slId = sl.orderId;
  if (tp) p.orders.tpId = tp.orderId;
  if (p.status === "pending" && parent) {
    if (parent.status === "Filled") {
      p.entry = num(parent.avgPrice) || p.ref;
      p.status = "open";
      log("trade", `LIVE ${p.symbol} entry filled @ ${p.entry}`);
    } else if (["Cancelled", "Inactive"].includes(parent.status)) {
      p.status = "cancelled";
      p.why = `entry ${parent.status}`;
      log("warn", `LIVE ${p.symbol} entry ${parent.status}`);
    }
  }
  if (p.status !== "open") return;
  if (sl?.status === "Filled") return closePos(p, num(sl.avgPrice) || p.stop, "stop");
  if (tp?.status === "Filled") return closePos(p, num(tp.avgPrice) || p.target, "target");
}

// ---------------------------------------------------------------------------
// Flatten (EOD, loss limit, kill switch, manual close)
// ---------------------------------------------------------------------------
// One close at a time per position: the kill switch, the loss limit and the
// EOD flatten can overlap, and a second MKT close would flip the position.
async function closeOne(p, why) {
  if (p.closing || (p.status !== "open" && p.status !== "pending")) return;
  p.closing = true;
  try {
    await closeOneInner(p, why);
  } finally {
    p.closing = false;
  }
}

async function closeOneInner(p, why) {
  if (p.status === "pending" && p.kind === "paper") { p.status = "cancelled"; p.why = why; return; }
  if (p.kind === "paper") {
    const q = (await snapshot([p.conid])).get(p.conid);
    const px = q ? (p.dir > 0 ? q.bid || q.last : q.ask || q.last) : p.last;
    return closePos(p, px - p.dir * 0.01, why);
  }
  // live: cancel the bracket, confirm the children are dead, then close only
  // what is really held. A MKT close is NEVER sent while a stop/target child
  // might still be working — if it filled afterwards the position would flip.
  // Anything unclear returns without closing; callers retry on the next tick.
  const book = await liveOrders();
  const par = book.get(p.orders.parent);
  if (!par) {
    // Not in the order book: never placed, or the book is unreadable (flap).
    const held = await livePositionQty(p.conid);
    if (p.status === "pending" && held != null && Math.sign(held) !== p.dir) {
      p.status = "cancelled";
      p.why = `${why} (entry never filled)`;
      return;
    }
    if (!p.warnedBook) { p.warnedBook = true; log("warn", `LIVE ${p.symbol}: orders not visible at IBKR — retrying close`); }
    return;
  }
  for (const o of [findChild(book, p, "sl"), findChild(book, p, "tp"), par]) {
    if (o && !TERMINAL.includes(o.status)) await cancelOrder(o.orderId);
  }
  let after = book, sl, tp;
  for (let i = 0; i < 4; i++) {
    await sleep(1500);
    after = await liveOrders();
    sl = findChild(after, p, "sl");
    tp = findChild(after, p, "tp");
    if (sl?.status === "Filled") return closePos(p, num(sl.avgPrice) || p.stop, "stop");
    if (tp?.status === "Filled") return closePos(p, num(tp.avgPrice) || p.target, "target");
    if (after.get(p.orders.parent) && (!sl || TERMINAL.includes(sl.status)) && (!tp || TERMINAL.includes(tp.status))) break;
    sl = tp = { status: "unknown" };
  }
  if (!after.get(p.orders.parent) || (sl && !TERMINAL.includes(sl.status)) || (tp && !TERMINAL.includes(tp.status))) {
    log("warn", `LIVE ${p.symbol}: bracket not confirmed cancelled — retrying close`);
    return;
  }
  if (p.status === "pending") {
    const pp = after.get(p.orders.parent);
    if (pp.status !== "Filled") { p.status = "cancelled"; p.why = why; return; }
    p.entry = num(pp.avgPrice) || p.ref;
  }
  const held = await livePositionQty(p.conid);
  if (held == null) {
    if (!p.warnedPos) { p.warnedPos = true; log("error", `LIVE ${p.symbol}: cannot read position — retrying; close by hand if this repeats`); }
    return;
  }
  const qty = Math.min(p.qty, Math.abs(held));
  if (qty < 1 || Math.sign(held) !== p.dir) {
    log("warn", `LIVE ${p.symbol}: nothing left to close (held ${held})`);
    return closePos(p, p.last, `${why} (already flat)`);
  }
  const ref = `${p.orders.parent}-x${Date.now() % 1000}`;
  await submit([{ acctId: gwStatus.account, conid: p.conid, cOID: ref, orderType: "MKT", side: p.dir > 0 ? "SELL" : "BUY", quantity: qty, tif: "DAY" }]);
  await sleep(2000);
  const final = await liveOrders();
  // Belt and braces: kill any closing-side order still working on this contract
  // (a bracket child IBKR listed under an unexpected ref/type).
  const closeSide = p.dir > 0 ? "SELL" : "BUY";
  for (const o of final.rows || []) {
    if (Number(o.conid) === p.conid && o.side === closeSide && o.order_ref !== ref && !TERMINAL.includes(o.status) &&
        String(o.order_ref || "").startsWith(p.orders.parent)) {
      log("warn", `LIVE ${p.symbol}: cancelling leftover order ${o.orderId}`);
      await cancelOrder(o.orderId);
    }
  }
  const fill = final.get(ref);
  const q = (await snapshot([p.conid])).get(p.conid);
  closePos(p, num(fill?.avgPrice) || q?.last || p.last, why);
}

async function flattenAll(why) {
  const day = state.day;
  for (const p of day.positions.filter((x) => x.status === "open" || x.status === "pending")) {
    try { await closeOne(p, why); } catch (e) { log("error", `${p.symbol} flatten: ${e.message}`); }
  }
  day.realized = round2(day.positions.filter((p) => p.status === "closed").reduce((a, p) => a + p.pnl, 0));
  save();
}

// ---------------------------------------------------------------------------
// Main clock
// ---------------------------------------------------------------------------
let ticking = false;
let lastGwCheck = 0;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const t = et();
    rollDay(t);
    const day = state.day;
    const marketWindow = isTradingDay(t) && t.min >= 9 * 60 && t.min < 16 * 60 + 5;
    if (Date.now() - lastGwCheck > (marketWindow ? 20000 : 120000)) { lastGwCheck = Date.now(); await checkGateway(); }
    if (!marketWindow) {
      day.phase = "closed";
      return;
    }
    const flatMin = flatMinFor(t.key);
    if (t.min < 570) day.phase = "premarket";
    else if (t.min < SCAN_MIN) day.phase = "opening";
    else if (t.min < ENTRY_MIN) {
      day.phase = "scanning";
      if (!day.scanned && gwStatus.authenticated) await scan();
    } else if (!day.decided && t.min < ENTRY_LAST_MIN) {
      day.phase = "deciding";
      if (!day.scanned && gwStatus.authenticated) await scan();
      if (day.scanned && gwStatus.authenticated) await decide();
    } else if (t.min < flatMin) {
      if (!day.decided) {
        day.decided = true;
        log("warn", "missed the 09:45 window (gateway down or engine started late) — no entries today");
      }
      day.phase = day.halted ? "halted" : "managing";
      if (gwStatus.authenticated) await manage();
    } else if (!day.flattened) {
      // Retried every tick until nothing is left open: brackets are DAY
      // orders, so a position that survives 16:00 would sit unprotected.
      day.phase = "flattening";
      if (gwStatus.authenticated || day.positions.every((p) => p.kind === "paper")) await flattenAll("eod");
      day.flattened = !day.positions.some((p) => p.status === "open" || p.status === "pending");
      if (day.flattened) writeJournal(day);
      else if (t.min >= 16 * 60 && !day.flattenWarned) {
        day.flattenWarned = true;
        log("error", "EOD flatten incomplete — check IBKR positions by hand");
      }
    } else {
      day.phase = "done";
    }
  } catch (e) {
    log("error", `tick: ${e.message}`);
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
const tokenCache = new Map(); // token -> {email, until}
async function authEmail(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const c = tokenCache.get(token);
  if (c && c.until > Date.now()) return c.email;
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = await r.json().catch(() => ({}));
  const email = (u.email || "").toLowerCase();
  tokenCache.set(token, { email, until: Date.now() + 60_000 });
  if (tokenCache.size > 200) tokenCache.delete(tokenCache.keys().next().value);
  return email;
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });
}

function status() {
  const day = state.day || newDay(et().key);
  const open = day.positions.filter((p) => p.status === "open");
  const closed = day.positions.filter((p) => p.status === "closed");
  return {
    now: Date.now(), et: et(), mode: state.mode, config: state.config,
    gateway: { authenticated: gwStatus.authenticated, ok: gwStatus.ok, checked: gwStatus.checked, account: gwStatus.account ? `${gwStatus.account.slice(0, 3)}…${gwStatus.account.slice(-3)}` : null },
    day: {
      key: day.key, phase: day.phase, scanned: day.scanned, decided: day.decided, halted: day.halted,
      haltReason: day.haltReason, universe: day.universe, scanAt: day.scanAt, decideAt: day.decideAt,
      spy: day.spy, entryMode: day.entryMode, candidates: day.candidates,
      positions: day.positions,
      realized: round2(closed.reduce((a, p) => a + p.pnl, 0)),
      unrealized: round2(open.reduce((a, p) => a + p.pnl, 0)),
      wins: closed.filter((p) => p.pnl > 0).length, losses: closed.filter((p) => p.pnl <= 0).length,
    },
    log: state.log.slice(-80),
    schedule: { scan: "09:36", entry: "09:45", flatten: EARLY_CLOSE.has(day.key) ? "12:55" : "15:55" },
  };
}

function history() {
  const files = fs.readdirSync(JOURNAL_DIR).filter((f) => f.endsWith(".json")).sort().slice(-90);
  return files.map((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(JOURNAL_DIR, f), "utf8"));
      return { key: j.key, mode: j.mode, trades: j.trades, wins: j.wins, pnl: j.pnl, haltReason: j.haltReason,
        positions: (j.positions || []).filter((p) => p.status === "closed").map((p) => ({ symbol: p.symbol, dir: p.dir, qty: p.qty, entry: p.entry, exit: p.exit, why: p.why, pnl: p.pnl, kind: p.kind })) };
    } catch { return null; }
  }).filter(Boolean);
}

function setConfig(body) {
  const next = { ...state.config };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
    next[k] = k === "topN" ? Math.round(v) : v;
  }
  if (body.side !== undefined) {
    if (!["both", "long"].includes(body.side)) throw new Error("side must be both or long");
    next.side = body.side;
  }
  state.config = next;
  log("info", `config updated: ${JSON.stringify(body)}`);
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/^\/engine-api/, "");
    if (p === "/health") return send(200, { ok: true, mode: state.mode, phase: state.day?.phase });
    const email = await authEmail(req);
    if (!email) return send(401, { error: "Sign in required" });
    if (email !== CONTROL_EMAIL) return send(403, { error: "Not available for this account" });

    if (req.method === "GET" && p === "/status") return send(200, status());
    if (req.method === "GET" && p === "/history") return send(200, history());
    if (req.method === "POST" && p === "/config") {
      try {
        setConfig(await readBody(req));
      } catch (e) {
        return send(400, { error: e.message });
      }
      save();
      return send(200, status());
    }
    if (req.method === "POST" && p === "/mode") {
      const b = await readBody(req);
      if (!["off", "paper", "live"].includes(b.mode)) return send(400, { error: "bad mode" });
      if (b.mode === "live") {
        if (b.confirm !== "LIVE") return send(400, { error: "Type LIVE to arm real-money trading" });
        if (!(await checkGateway())) return send(409, { error: "IBKR session is not authenticated" });
        if (!(await liveEquityOk())) return send(409, { error: `Net liquidation must be ≥ $${LIVE_MIN_EQUITY} (PDT)` });
      }
      state.mode = b.mode;
      log("warn", `mode → ${b.mode.toUpperCase()} (by ${email})`);
      save();
      return send(200, status());
    }
    if (req.method === "POST" && p === "/kill") {
      state.mode = "off";
      log("warn", `KILL SWITCH by ${email} — flattening everything, engine OFF`);
      if (state.day) { state.day.halted = true; state.day.haltReason = "kill switch"; await flattenAll("kill switch"); }
      save();
      return send(200, status());
    }
    if (req.method === "POST" && p === "/close") {
      const b = await readBody(req);
      const pos = state.day?.positions.find((x) => x.id === b.id && (x.status === "open" || x.status === "pending"));
      if (!pos) return send(404, { error: "No such open position" });
      await closeOne(pos, "manual");
      save();
      return send(200, status());
    }
    return send(404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`nova-engine on 127.0.0.1:${PORT} · mode ${state.mode} · gateway ${GW}`);
    rollDay(et());
    checkGateway().then(() => log("info", `engine up · mode ${state.mode.toUpperCase()} · IBKR ${gwStatus.authenticated ? "authenticated" : "NOT authenticated"}`));
  });
  setInterval(tick, 2000);
  process.on("SIGTERM", () => { if (state.day) writeJournal(state.day); try { fs.writeFileSync(STATE_PATH, JSON.stringify(state)); } catch (_) {} process.exit(0); });
  process.on("unhandledRejection", (e) => console.error("unhandled:", e));
}

// Exposed for the offline replay test (test-replay.cjs); not used in production.
module.exports = { state, newDay, scan, decide, manage, flattenAll, checkGateway, server, status, et, enter, snapshot };
