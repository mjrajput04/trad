// Intraday "Stocks in Play" lab — 5m Yahoo bars, conservative fills, real IBKR costs.
// node bt.js            → grid of variants, IS/OOS split
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "data");
const ETF = new Set("SPY QQQ IWM TQQQ SQQQ SOXL SOXS TNA UVXY TSLL NVDL CONL MSTU".split(" "));

const ET_OFF = -4 * 3600; // whole 60d window (Aug–Oct) is EDT
const etDate = (t) => new Date((t + ET_OFF) * 1000).toISOString().slice(0, 10);
const etMin = (t) => { const d = new Date((t + ET_OFF) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

// ---------- load ----------
const syms = {};
for (const f of fs.readdirSync(DIR)) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const days = new Map();
  for (const b of j.m5) {
    const m = etMin(b.t);
    if (m < 570 || m >= 960) continue;
    const k = etDate(b.t);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push({ ...b, m });
  }
  // daily: ATR14 + avg vol known BEFORE each date
  const d1 = j.d1.map((b) => ({ ...b, k: etDate(b.t) }));
  const prior = new Map(); // date -> {atr, avgVol, prevClose}
  for (let i = 15; i < d1.length; i++) {
    let trs = 0, vol = 0;
    for (let k = i - 14; k < i; k++) {
      const pc = d1[k - 1].c;
      trs += Math.max(d1[k].h - d1[k].l, Math.abs(d1[k].h - pc), Math.abs(d1[k].l - pc));
      vol += d1[k].v;
    }
    prior.set(d1[i].k, { atr: trs / 14, avgVol: vol / 14, prevClose: d1[i - 1].c });
  }
  syms[j.s] = { days, prior };
}
const allDates = [...new Set(Object.values(syms).flatMap((s) => [...s.days.keys()]))].sort();

// SPY direction over the opening range (1 bar = 5m, 3 bars = 15m)
const mkt = new Map();
if (syms.SPY) for (const [k, b] of syms.SPY.days) if (b.length > 3 && b[0].m === 570) mkt.set(k, { 1: Math.sign(b[0].c - b[0].o), 3: Math.sign(b[2].c - b[0].o) });

// first-bar volume history for relative volume
for (const s of Object.values(syms)) {
  s.rv = new Map();
  const ks = [...s.days.keys()].sort();
  for (let i = 0; i < ks.length; i++) {
    const bars = s.days.get(ks[i]);
    if (!bars.length || bars[0].m !== 570) continue;
    const hist = [];
    for (let k = Math.max(0, i - 14); k < i; k++) {
      const b = s.days.get(ks[k]);
      if (b.length && b[0].m === 570) hist.push(b[0].v);
    }
    if (hist.length >= 10) {
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
      if (avg > 0) s.rv.set(ks[i], bars[0].v / avg);
    }
  }
}

// ---------- costs (IBKR Fixed) ----------
const commission = (sh, px) => Math.min(Math.max(1.0, 0.005 * sh), 0.01 * sh * px);
const regFees = (sh, px) => 0.0000278 * sh * px + Math.min(0.000166 * sh, 8.3); // sell side only
const slip = (px) => Math.max(0.01, 0.0002 * px);

// ---------- one trade ----------
function sim(bars, dir, cfg, atr) {
  const nOR = cfg.orBars || 1;
  const orB = bars.slice(0, nOR);
  let entry = null, ei = -1;
  const ORH = Math.max(...orB.map((b) => b.h)), ORL = Math.min(...orB.map((b) => b.l));
  if (cfg.entry === "open2") {
    entry = bars[nOR].o + dir * slip(bars[nOR].o); ei = nOR;
  } else { // break of opening range
    const lvl = dir > 0 ? ORH : ORL;
    for (let i = nOR; i < bars.length && bars[i].m <= cfg.lastEntryMin; i++) {
      const b = bars[i];
      if (dir > 0 && b.h >= lvl + 0.01) { entry = Math.max(lvl + 0.01, b.o) + slip(lvl); ei = i; break; }
      if (dir < 0 && b.l <= lvl - 0.01) { entry = Math.min(lvl - 0.01, b.o) - slip(lvl); ei = i; break; }
    }
  }
  if (entry == null) return null;
  let stopDist = cfg.stop === "or" ? (dir > 0 ? entry - ORL : ORH - entry) : cfg.stopAtr * atr;
  if (!(stopDist > 0.01)) stopDist = Math.max(0.02, 0.05 * atr);
  let stop = entry - dir * stopDist;
  let sh = Math.floor(cfg.risk / stopDist);
  sh = Math.min(sh, Math.floor(cfg.maxNotional / entry));
  if (sh < 1) return null;

  let target = null;
  if (cfg.exit.startsWith("R")) target = entry + dir * parseFloat(cfg.exit.slice(1)) * stopDist;
  if (cfg.exit.startsWith("$")) target = entry + dir * (parseFloat(cfg.exit.slice(1)) / sh);
  const trail = cfg.exit === "trail";
  let best = entry, beOn = false;

  let exit = null, why = "";
  for (let i = ei; i < bars.length; i++) {
    const b = bars[i];
    const isEntryBar = i === ei;
    // stop first (conservative)
    if (dir > 0 ? b.l <= stop : b.h >= stop) {
      const px = dir > 0 ? Math.min(stop, b.o) : Math.max(stop, b.o);
      exit = isEntryBar ? stop - dir * slip(stop) : px - dir * slip(px); why = beOn ? "be/trail" : "stop"; break;
    }
    if (target != null && !isEntryBar && (dir > 0 ? b.h >= target + 0.01 : b.l <= target - 0.01)) {
      exit = dir > 0 ? Math.max(target, b.o) : Math.min(target, b.o); why = "target"; break;
    }
    if (b.m >= cfg.flatMin) { exit = b.c - dir * slip(b.c); why = "eod"; break; }
    // trail management at bar close
    if (trail) {
      best = dir > 0 ? Math.max(best, b.h) : Math.min(best, b.l);
      const gainR = (dir * (best - entry)) / stopDist;
      if (gainR >= cfg.beAt) { const be = entry + dir * 0.05 * stopDist; stop = dir > 0 ? Math.max(stop, be) : Math.min(stop, be); beOn = true; }
      if (gainR >= cfg.trailFrom) { const ts = best - dir * cfg.trailR * stopDist; stop = dir > 0 ? Math.max(stop, ts) : Math.min(stop, ts); }
    }
  }
  if (exit == null) { const b = bars[bars.length - 1]; exit = b.c - dir * slip(b.c); why = "eod"; }
  const gross = dir * (exit - entry) * sh;
  const sellPx = dir > 0 ? exit : entry;
  const cost = commission(sh, entry) + commission(sh, exit) + regFees(sh, sellPx);
  return { pnl: gross - cost, gross, cost, R: (gross - cost) / cfg.risk, why, sh, entry, exit, stopDist };
}

// ---------- run a config over a date range ----------
function run(cfg, dates) {
  const trades = [];
  for (const d of dates) {
    const cands = [];
    for (const [s, S] of Object.entries(syms)) {
      if (!cfg.etf && ETF.has(s)) continue;
      const bars = S.days.get(d), rv = S.rv.get(d), pr = S.prior.get(d);
      if (!bars || bars.length < 70 || bars[0].m !== 570 || rv == null || !pr) continue;
      if (bars[0].o < 5 || pr.avgVol < 1e6 || pr.atr < 0.5) continue;
      if (rv < cfg.minRv) continue;
      const nOR = cfg.orBars || 1;
      const body = bars[nOR - 1].c - bars[0].o;
      if (body === 0) continue;
      const dir = body > 0 ? 1 : -1;
      const gap = (bars[0].o - pr.prevClose) / pr.prevClose;
      if (cfg.gapAlign && (Math.sign(gap) !== dir || Math.abs(gap) < cfg.gapAlign)) continue;
      if (cfg.mktAlign) { const m = mkt.get(d); if (!m || m[nOR] !== dir) continue; }
      if (cfg.minGap && Math.abs(gap) < cfg.minGap) continue;
      if (cfg.side === "long" && dir < 0) continue;
      if (cfg.side === "short" && dir > 0) continue;
      cands.push({ s, bars, rv, dir, atr: pr.atr });
    }
    cands.sort((a, b) => b.rv - a.rv);
    for (const c of cands.slice(0, cfg.topN)) {
      const t = sim(c.bars, c.dir, cfg, c.atr);
      if (t) trades.push({ ...t, d, s: c.s, dir: c.dir, rv: c.rv });
    }
  }
  return trades;
}

function stats(trades) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const net = gw - gl;
  const byDay = new Map();
  for (const t of trades) byDay.set(t.d, (byDay.get(t.d) ?? 0) + t.pnl);
  let eq = 0, peak = 0, dd = 0;
  for (const d of [...byDay.keys()].sort()) { eq += byDay.get(d); peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  let mcl = 0, cl = 0;
  for (const t of trades) { if (t.pnl <= 0) { cl++; mcl = Math.max(mcl, cl); } else cl = 0; }
  const greenDays = [...byDay.values()].filter((v) => v > 0).length;
  const cost = trades.reduce((a, t) => a + t.cost, 0);
  return {
    n, win: +(100 * wins.length / n).toFixed(1), pf: +(gw / (gl || 1)).toFixed(2), net: Math.round(net),
    perTrade: +(net / n).toFixed(1), avgR: +(trades.reduce((a, t) => a + t.R, 0) / n).toFixed(3),
    dd: Math.round(dd), mcl, days: byDay.size, green: +(100 * greenDays / byDay.size).toFixed(0),
    perDay: Math.round(net / byDay.size), cost: Math.round(cost),
  };
}

module.exports = { syms, allDates, run, stats, sim };

if (require.main === module) {
  const usable = allDates.filter((d) => Object.values(syms).some((s) => s.rv.has(d)));
  const half = Math.floor(usable.length / 2);
  const IS = usable.slice(0, half), OOS = usable.slice(half);
  console.log(`symbols ${Object.keys(syms).length}  days ${usable.length} (${usable[0]} → ${usable.at(-1)})  IS ${IS.length} / OOS ${OOS.length}`);
  const base = { risk: 50, maxNotional: 12000, minRv: 1.0, topN: 10, side: "both", etf: false, lastEntryMin: 690, flatMin: 955, beAt: 1, trailFrom: 1.5, trailR: 1 };
  const grid = [];
  for (const entry of ["open2", "break"])
    for (const stop of ["atr10", "atr20", "or"])
      for (const exit of ["eod", "R0.5", "R1", "R2", "R3", "$20", "$30", "$40", "trail"])
        for (const topN of [5, 10, 20])
          grid.push({ ...base, entry, stop, stopAtr: stop === "atr10" ? 0.1 : 0.2, exit, topN });
  const rows = [];
  for (const cfg of grid) {
    const a = stats(run(cfg, IS)), b = stats(run(cfg, OOS)), all = stats(run(cfg, usable));
    rows.push({ k: `${cfg.entry}/${cfg.stop}/${cfg.exit}/top${cfg.topN}`, IS: a, OOS: b, ALL: all });
  }
  rows.sort((x, y) => y.ALL.net - x.ALL.net);
  const f = (s) => s.n ? `n${String(s.n).padStart(4)} w${String(s.win).padStart(5)}% pf${String(s.pf).padStart(5)} $${String(s.net).padStart(6)} R${String(s.avgR).padStart(7)}` : "—";
  console.log("variant".padEnd(28), "IN-SAMPLE".padEnd(46), "OUT-OF-SAMPLE".padEnd(46), "ALL: dd mcl green% $/day");
  for (const r of rows) console.log(r.k.padEnd(28), f(r.IS).padEnd(46), f(r.OOS).padEnd(46), `dd${r.ALL.dd} mcl${r.ALL.mcl} g${r.ALL.green}% $${r.ALL.perDay}/d`);
  fs.writeFileSync(path.join(__dirname, "grid.json"), JSON.stringify(rows, null, 1));
}
