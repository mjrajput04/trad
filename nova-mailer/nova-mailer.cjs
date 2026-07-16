// NOVA Mailer — server-side email engine (PM2: nova-mailer).
// Run with NODE_PATH=/var/www/admin-api/node_modules (reuses nodemailer + pg).
//
// What it does, all times US/Eastern:
//  1) Every 60s pulls today's IBKR executions from the local gateway, archives
//     them into Supabase (ibkr_trades) and emails each NEW fill to ALERT_EMAIL.
//  2) Every 60s polls the TradeScope engine for STOCK alerts and emails each
//     new alert to ALERT_EMAIL.
//  3) Weekdays at 16:10 ET sends a contract-note style DAILY summary (trades,
//     per-trade commission, FIFO realized P&L) to EVERY registered user.
//  4) On the last day of the month (16:20 ET) sends the MONTH rollup to every
//     registered user.
//
// Test: node nova-mailer.cjs --test   (sends today's summary to ALERT_EMAIL only)

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

// ---- env (reuse admin-api's .env for Gmail + Postgres creds) ----
const ENV_PATH = process.env.ENV_PATH || "/var/www/admin-api/.env";
try {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch (e) {
  console.error("cannot read env:", e.message);
}
const {
  PGHOST, PGUSER = "postgres", PGDATABASE = "postgres", PGPASSWORD,
  GMAIL_USER, GMAIL_APP_PASS,
} = process.env;
const ALERT_EMAIL = process.env.ALERT_EMAIL || "nassphx@gmail.com";
const GW = "http://127.0.0.1:7175/v1/api";
const TS = "http://127.0.0.1:3100/api";
const UA = { "User-Agent": "nova-mailer" };

const pool = new Pool({ host: PGHOST, user: PGUSER, database: PGDATABASE, password: PGPASSWORD, port: 5432, ssl: { rejectUnauthorized: false }, max: 3 });
const mailer = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 465, secure: true,
  auth: { user: GMAIL_USER, pass: (GMAIL_APP_PASS || "").replace(/\s+/g, "") },
});

// ---- tiny persisted state ----
const STATE_PATH = path.join(__dirname, "state.json");
let state = { seenExecs: [], seenAlerts: [], lastDailyKey: "", lastMonthlyKey: "" };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) }; } catch (_) {}
const saveState = () => {
  state.seenExecs = state.seenExecs.slice(-3000);
  state.seenAlerts = state.seenAlerts.slice(-500);
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state)); } catch (_) {}
};

// ---- helpers ----
const etParts = (d = new Date()) => {
  const s = d.toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
  const [date, time] = s.split(", ");
  const [mo, da, yr] = date.split("/").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return { yr, mo, da, hh, mm, key: `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, monthKey: `${yr}-${String(mo).padStart(2, "0")}` };
};
const money = (n) => `$${Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n) => `${n >= 0 ? "+" : "−"}${money(n)}`;
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };

async function sendMail(to, subject, html) {
  await mailer.sendMail({ from: `NOVA Terminal <${GMAIL_USER}>`, to, subject, html });
  console.log(`[mail] "${subject}" -> ${Array.isArray(to) ? to.join(",") : to}`);
}

async function allUserEmails() {
  try {
    const { rows } = await pool.query(`select email from auth.users where email is not null`);
    const emails = rows.map((r) => r.email).filter(Boolean);
    return emails.length ? emails : [ALERT_EMAIL];
  } catch (e) {
    console.error("user emails:", e.message);
    return [ALERT_EMAIL];
  }
}

// ---- FIFO realized P&L (same algorithm as the Analysis page) ----
function fifoRealized(trades) {
  const bySym = new Map();
  for (const t of trades) {
    if (!t.symbol || !t.quantity || !t.price) continue;
    if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
    bySym.get(t.symbol).push(t);
  }
  const perDay = new Map();   // dayKey -> pnl
  const perSym = new Map();   // symbol -> pnl (of closed qty)
  for (const [symbol, fills] of bySym) {
    fills.sort((a, b) => a.time - b.time);
    const lots = [];
    for (const f of fills) {
      const dir = f.side === "BUY" ? 1 : -1;
      let remaining = f.quantity;
      let fillPnl = 0, matched = false;
      while (remaining > 0 && lots.length && Math.sign(lots[0].qty) === -dir) {
        const lot = lots[0];
        const m = Math.min(remaining, Math.abs(lot.qty));
        fillPnl += lot.qty > 0 ? (f.price - lot.price) * m : (lot.price - f.price) * m;
        lot.qty -= m * Math.sign(lot.qty);
        if (lot.qty === 0) lots.shift();
        remaining -= m;
        matched = true;
      }
      if (remaining > 0) lots.push({ qty: dir * remaining, price: f.price });
      if (matched) {
        const k = etParts(new Date(f.time)).key;
        perDay.set(k, (perDay.get(k) ?? 0) + fillPnl);
        perSym.set(symbol, (perSym.get(symbol) ?? 0) + fillPnl);
      }
    }
  }
  return { perDay, perSym };
}

// ---- archive access ----
async function archiveAll() {
  const { rows } = await pool.query(
    `select execution_id, symbol, side, quantity, price, commission, net_amount,
            extract(epoch from traded_at) * 1000 as t
     from public.ibkr_trades order by traded_at asc`
  );
  return rows.map((r) => ({
    executionId: r.execution_id, symbol: r.symbol, side: r.side,
    quantity: Number(r.quantity), price: Number(r.price),
    commission: Number(r.commission || 0), netAmount: Number(r.net_amount || 0),
    time: Number(r.t),
  }));
}

// ---- 1) trade watcher ----
async function pollTrades() {
  let data;
  try {
    const res = await fetch(`${GW}/iserver/account/trades?days=1`, { headers: UA });
    if (!res.ok) return;
    data = await res.json();
  } catch (_) { return; } // gateway down / not authenticated — try next minute
  if (!Array.isArray(data)) return;

  const seen = new Set(state.seenExecs);
  const fresh = [];
  for (const t of data) {
    const id = String(t.execution_id ?? t.exec_id ?? "");
    if (!id || seen.has(id)) continue;
    fresh.push({
      executionId: id,
      symbol: t.symbol ?? t.ticker ?? t.contract_description_1 ?? "",
      side: t.side === "B" || t.side === "BUY" ? "BUY" : "SELL",
      quantity: num(t.size),
      price: num(t.price),
      time: typeof t.trade_time_r === "number" ? t.trade_time_r : Date.parse(t.trade_time ?? "") || Date.now(),
      commission: num(t.commission),
      netAmount: num(t.net_amount),
    });
  }
  if (!fresh.length) return;

  // archive (idempotent)
  for (const f of fresh) {
    await pool.query(
      `insert into public.ibkr_trades (execution_id, symbol, side, quantity, price, commission, net_amount, traded_at)
       values ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8/1000.0))
       on conflict (execution_id) do nothing`,
      [f.executionId, f.symbol, f.side, f.quantity, f.price, f.commission, f.netAmount, f.time]
    ).catch((e) => console.error("archive:", e.message));
    state.seenExecs.push(f.executionId);
  }
  saveState();

  // skip the email flood on very first run (whole day marked fresh at boot)
  if (firstTradePoll) { firstTradePoll = false; return; }

  const rowsHtml = fresh.map((f) => `
    <tr>
      <td style="padding:6px 10px">${new Date(f.time).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET</td>
      <td style="padding:6px 10px"><b>${f.symbol}</b></td>
      <td style="padding:6px 10px;color:${f.side === "BUY" ? "#0a7d38" : "#b3232c"}"><b>${f.side}</b></td>
      <td style="padding:6px 10px;text-align:right">${f.quantity}</td>
      <td style="padding:6px 10px;text-align:right">${money(f.price)}</td>
      <td style="padding:6px 10px;text-align:right">${money(Math.abs(f.netAmount || f.price * f.quantity))}</td>
    </tr>`).join("");
  const subj = fresh.length === 1
    ? `${fresh[0].side === "BUY" ? "🟢" : "🔴"} ${fresh[0].side} ${fresh[0].quantity} ${fresh[0].symbol} @ ${money(fresh[0].price)}`
    : `⚡ ${fresh.length} executions on IBKR`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      <h2 style="margin:0 0 8px">Trade executed</h2>
      <table style="border-collapse:collapse;border:1px solid #ddd">
        <tr style="background:#f4f4f6"><th style="padding:6px 10px">Time</th><th style="padding:6px 10px">Symbol</th><th style="padding:6px 10px">Side</th><th style="padding:6px 10px">Qty</th><th style="padding:6px 10px">Price</th><th style="padding:6px 10px">Value</th></tr>
        ${rowsHtml}
      </table>
      <p style="color:#777;font-size:12px">NOVA Terminal · https://nassphx.com</p>
    </div>`;
  await sendMail(ALERT_EMAIL, subj, html).catch((e) => console.error("trade mail:", e.message));
}
let firstTradePoll = true;

// ---- 2) stock-alert watcher ----
let firstAlertPoll = true;
async function pollAlerts() {
  let data;
  try {
    const res = await fetch(`${TS}/alerts`);
    if (!res.ok) return;
    data = await res.json();
  } catch (_) { return; }
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const seen = new Set(state.seenAlerts);
  const fresh = alerts.filter((a) => a?.id != null && a.symbol && !seen.has(String(a.id)));
  if (fresh.length) {
    for (const a of fresh) state.seenAlerts.push(String(a.id));
    saveState();
  }
  if (firstAlertPoll) { firstAlertPoll = false; return; } // don't re-mail existing alerts on boot
  for (const a of fresh) {
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <h2 style="margin:0 0 4px">🔔 ${a.symbol} — BUY setup (Score ${Math.round(a.score)})</h2>
        <table style="border-collapse:collapse;border:1px solid #ddd;margin:8px 0">
          <tr style="background:#f4f4f6"><th style="padding:6px 12px">Entry</th><th style="padding:6px 12px">Target</th><th style="padding:6px 12px">Stop</th></tr>
          <tr>
            <td style="padding:6px 12px;text-align:center"><b>${money(a.entry)}</b></td>
            <td style="padding:6px 12px;text-align:center;color:#0a7d38"><b>${money(a.target)}</b> (${a.targetPct >= 0 ? "+" : ""}${(a.targetPct ?? 0).toFixed(2)}%)</td>
            <td style="padding:6px 12px;text-align:center;color:#b3232c"><b>${money(a.stop)}</b> (${(a.stopPct ?? 0).toFixed(2)}%)</td>
          </tr>
        </table>
        ${(a.reasons ?? []).length ? `<p style="margin:4px 0">${(a.reasons ?? []).slice(0, 4).join(" · ")}</p>` : ""}
        <p><a href="https://nassphx.com/alerts">Open NOVA → trade it</a></p>
        <p style="color:#777;font-size:12px">Stock alerts only · NOVA Terminal</p>
      </div>`;
    await sendMail(ALERT_EMAIL, `🔔 NOVA Alert: ${a.symbol} — entry ${money(a.entry)} (Score ${Math.round(a.score)})`, html)
      .catch((e) => console.error("alert mail:", e.message));
  }
}

// ---- 3) daily summary (contract-note style) ----
async function buildDailySummary(dayKeyEt) {
  const all = await archiveAll();
  const dayTrades = all.filter((t) => etParts(new Date(t.time)).key === dayKeyEt).sort((a, b) => a.time - b.time);
  const { perDay, perSym } = fifoRealized(all);
  const realized = perDay.get(dayKeyEt) ?? 0;
  const commissions = dayTrades.reduce((a, t) => a + Math.abs(t.commission || 0), 0);
  const gross = dayTrades.reduce((a, t) => a + Math.abs(t.netAmount || t.price * t.quantity), 0);
  const buys = dayTrades.filter((t) => t.side === "BUY").length;

  const rows = dayTrades.map((t) => `
    <tr>
      <td style="padding:5px 8px">${new Date(t.time).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}</td>
      <td style="padding:5px 8px"><b>${t.symbol}</b></td>
      <td style="padding:5px 8px;color:${t.side === "BUY" ? "#0a7d38" : "#b3232c"}">${t.side}</td>
      <td style="padding:5px 8px;text-align:right">${t.quantity}</td>
      <td style="padding:5px 8px;text-align:right">${money(t.price)}</td>
      <td style="padding:5px 8px;text-align:right">${money(Math.abs(t.commission || 0))}</td>
      <td style="padding:5px 8px;text-align:right">${money(Math.abs(t.netAmount || t.price * t.quantity))}</td>
    </tr>`).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:680px">
      <h2 style="margin:0 0 2px">NOVA Terminal — Daily Statement</h2>
      <p style="margin:0 0 12px;color:#555">${dayKeyEt} (US/Eastern) · IBKR</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:14px">
        <tr>
          <td style="padding:10px;border:1px solid #ddd"><div style="color:#777;font-size:11px">TRADES</div><b style="font-size:18px">${dayTrades.length}</b> <span style="color:#777">(${buys} buy / ${dayTrades.length - buys} sell)</span></td>
          <td style="padding:10px;border:1px solid #ddd"><div style="color:#777;font-size:11px">REALIZED P&amp;L</div><b style="font-size:18px;color:${realized >= 0 ? "#0a7d38" : "#b3232c"}">${signed(realized)}</b></td>
          <td style="padding:10px;border:1px solid #ddd"><div style="color:#777;font-size:11px">COMMISSIONS</div><b style="font-size:18px">${money(commissions)}</b></td>
          <td style="padding:10px;border:1px solid #ddd"><div style="color:#777;font-size:11px">GROSS TRADED</div><b style="font-size:18px">${money(gross)}</b></td>
        </tr>
      </table>
      ${dayTrades.length ? `
      <table style="border-collapse:collapse;border:1px solid #ddd;width:100%">
        <tr style="background:#f4f4f6">
          <th style="padding:5px 8px;text-align:left">Time ET</th><th style="padding:5px 8px;text-align:left">Symbol</th><th style="padding:5px 8px;text-align:left">Side</th>
          <th style="padding:5px 8px">Qty</th><th style="padding:5px 8px">Price</th><th style="padding:5px 8px">Comm.</th><th style="padding:5px 8px">Value</th>
        </tr>
        ${rows}
      </table>` : `<p>No trades today.</p>`}
      <p style="color:#777;font-size:12px;margin-top:14px">Net after commissions: <b style="color:${(realized - commissions) >= 0 ? "#0a7d38" : "#b3232c"}">${signed(realized - commissions)}</b> · Full history: https://nassphx.com/analysis</p>
    </div>`;
  return { html, count: dayTrades.length, realized };
}

async function maybeDaily(now) {
  const et = etParts(now);
  const isWeekday = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay() % 6 !== 0;
  if (!isWeekday) return;
  if (et.hh < 16 || (et.hh === 16 && et.mm < 10)) return;
  if (state.lastDailyKey === et.key) return;
  state.lastDailyKey = et.key;
  saveState();
  const { html, count, realized } = await buildDailySummary(et.key);
  const to = await allUserEmails();
  await sendMail(to, `📒 NOVA Daily Statement ${et.key} — ${count} trades, ${signed(realized)}`, html)
    .catch((e) => console.error("daily mail:", e.message));

  // last day of the month? send the month rollup too
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  if (etParts(tomorrow).monthKey !== et.monthKey && state.lastMonthlyKey !== et.monthKey) {
    state.lastMonthlyKey = et.monthKey;
    saveState();
    await sendMonthly(et.monthKey, to).catch((e) => console.error("monthly mail:", e.message));
  }
}

// ---- 4) monthly rollup ----
async function sendMonthly(monthKey, to) {
  const all = await archiveAll();
  const monthTrades = all.filter((t) => etParts(new Date(t.time)).key.startsWith(monthKey));
  const { perDay, perSym } = fifoRealized(all);
  const realized = [...perDay.entries()].filter(([k]) => k.startsWith(monthKey)).reduce((a, [, v]) => a + v, 0);
  const commissions = monthTrades.reduce((a, t) => a + Math.abs(t.commission || 0), 0);
  const symRows = [...perSym.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, p]) => `
    <tr><td style="padding:5px 10px"><b>${s}</b></td><td style="padding:5px 10px;text-align:right;color:${p >= 0 ? "#0a7d38" : "#b3232c"}">${signed(p)}</td></tr>`).join("");
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:680px">
      <h2 style="margin:0 0 2px">NOVA Terminal — Monthly Statement</h2>
      <p style="margin:0 0 12px;color:#555">${monthKey} · IBKR</p>
      <p><b>${monthTrades.length}</b> executions · Realized P&amp;L <b style="color:${realized >= 0 ? "#0a7d38" : "#b3232c"}">${signed(realized)}</b> · Commissions <b>${money(commissions)}</b> · Net <b style="color:${(realized - commissions) >= 0 ? "#0a7d38" : "#b3232c"}">${signed(realized - commissions)}</b></p>
      <table style="border-collapse:collapse;border:1px solid #ddd">
        <tr style="background:#f4f4f6"><th style="padding:5px 10px;text-align:left">Symbol (all-time closed)</th><th style="padding:5px 10px">Realized</th></tr>
        ${symRows || "<tr><td style='padding:8px'>No closed trades yet</td><td></td></tr>"}
      </table>
      <p style="color:#777;font-size:12px;margin-top:14px">NOVA Terminal · https://nassphx.com/analysis</p>
    </div>`;
  await sendMail(to, `📊 NOVA Monthly Statement ${monthKey} — ${signed(realized)} realized`, html);
}

// ---- main ----
(async () => {
  if (process.argv.includes("--test")) {
    const et = etParts();
    console.log("TEST: sending today's summary to", ALERT_EMAIL);
    const { html, count, realized } = await buildDailySummary(et.key);
    await sendMail(ALERT_EMAIL, `🧪 TEST — NOVA Daily Statement ${et.key} — ${count} trades, ${signed(realized)}`, html);
    process.exit(0);
  }
  console.log("nova-mailer up — alerts+trades to", ALERT_EMAIL, "· daily/monthly to all users");
  setInterval(() => pollTrades().catch((e) => console.error("pollTrades:", e.message)), 60_000);
  setInterval(() => pollAlerts().catch((e) => console.error("pollAlerts:", e.message)), 60_000);
  setInterval(() => maybeDaily(new Date()).catch((e) => console.error("daily:", e.message)), 30_000);
  pollTrades().catch(() => {});
  pollAlerts().catch(() => {});
})();
