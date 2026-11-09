const express = require('express');
const http = require('node:http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8001;

// Origins allowed to make credentialed cross-site calls (the web app).
// Same-origin browser navigation to backend.nassphx.com sends no Origin header
// and is always allowed.
// Per-instance config (env), defaults = the owner's original deployment.
//   GATEWAY_PORT    — the IBKR Client Portal Gateway this proxy fronts
//   ALLOWED_ORIGINS — comma-separated app origins allowed to call it cross-site
const GATEWAY_PORT = process.env.GATEWAY_PORT || '7175';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['https://nassphx.com', 'https://www.nassphx.com'];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/localhost(:\d+)?$/.test(origin); // local dev
}

// CORS preflight (handled here so it never reaches the gateway)
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With');
  res.sendStatus(204);
});

// Health check (defined before the catch-all proxy)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Transparent proxy to the IBKR Client Portal Gateway.
//
// The gateway login is an SRP handshake spread across several requests that all
// rely on the SAME session cookies. To keep that intact behind the proxy we:
//   - pass the browser's own headers through untouched (no forced UA/Accept),
//   - rewrite Set-Cookie so cookies are host-only for backend.nassphx.com,
//     scoped to Path=/, and marked Secure + SameSite=None so they round-trip
//     during login AND can be sent cross-site by the app at nassphx.com,
//   - rewrite absolute localhost redirects to relative so the flow stays on
//     backend.nassphx.com.
// A FRESH connection per request to the gateway (found 2026-10-26).
//
// Node 19 made `http.globalAgent` keep-alive by default, and the proxy was
// using it. The Java gateway closes pooled connections on its own schedule, so
// a reused socket would hand Node the tail of one response as the head of the
// next: "Parse Error: Expected HTTP/, RTSP/ or ICE/" (HPE_INVALID_CONSTANT) and
// a 502 back to the browser. It struck whole bursts of parallel requests — the
// login page's own CSS and JS — so the sign-in silently could not complete,
// while a sequential curl from the server always passed and looked healthy.
// The gateway is on loopback, so a connection per request costs nothing.
const gatewayAgent = new http.Agent({ keepAlive: false, maxSockets: 128 });

const ibkrProxy = createProxyMiddleware({
  target: `http://localhost:${GATEWAY_PORT}`,
  agent: gatewayAgent,
  changeOrigin: true,
  secure: false,
  ws: true,
  logLevel: 'warn',
  // THE session-flapping root cause (found 2026-09-29): the gateway keys its
  // session state on the CLIENT IP it sees, and nginx passes the browser's real
  // public IP in X-Forwarded-For. So the browser got its own session view
  // ("authenticated:false" → UI red) while the server-side keepalive, arriving
  // as 127.0.0.1, held an authenticated one. Each side then fired
  // ssodh/init{compete:true} to take the session back from the other — an
  // endless ping-pong that logged the user out every few minutes.
  // Stripping the forwarding headers makes EVERY request look like it comes
  // from this proxy, so the browser and the keepalive share one session.
  onProxyReq: (proxyReq) => {
    proxyReq.removeHeader('x-forwarded-for');
    proxyReq.removeHeader('x-real-ip');
    proxyReq.removeHeader('x-forwarded-host');
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[ibkr] ${proxyRes.statusCode} ${req.method} ${req.url}`);

    // CORS for the cross-origin app (no-op for same-origin login navigation)
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
      proxyRes.headers['access-control-allow-origin'] = origin;
      proxyRes.headers['access-control-allow-credentials'] = 'true';
      proxyRes.headers['vary'] = 'Origin';
    }

    // Make gateway cookies usable on backend.nassphx.com (and cross-site for the app)
    const sc = proxyRes.headers['set-cookie'];
    if (sc) {
      proxyRes.headers['set-cookie'] = sc.map((cookie) =>
        cookie
          .replace(/;\s*Domain=[^;]*/gi, '')
          .replace(/;\s*Path=[^;]*/gi, '')
          .replace(/;\s*SameSite=[^;]*/gi, '')
          .replace(/;\s*Secure/gi, '')
          + '; Path=/; Secure; SameSite=None'
      );
    }

    // Keep redirects on backend.nassphx.com
    if (proxyRes.headers['location']) {
      proxyRes.headers['location'] = proxyRes.headers['location'].replace(
        new RegExp(`^https?://localhost:${GATEWAY_PORT}`, 'i'),
        ''
      );
    }
  },
  onError: (err, req, res) => {
    // The gateway (a 2023 build) now and then answers with something Node
    // cannot parse at all — "Parse Error: Expected HTTP/, RTSP/ or ICE/"
    // (HPE_INVALID_CONSTANT). It is not reproducible from this box under any
    // load or header combination, but a real browser loading the login page
    // hits it often enough that the page arrives without its CSS and
    // JavaScript, and the sign-in then silently cannot run.
    //
    // A GET carries no body and asks the gateway to change nothing, so asking
    // again on a fresh connection is safe and almost always returns a clean
    // response. Anything with a body is never retried — an order must never be
    // sent twice because a response was unreadable.
    const unparseable =
      err && (err.code === 'HPE_INVALID_CONSTANT' || /Parse Error/i.test(err.message || ''));
    if (unparseable && req.method === 'GET' && res && !res.headersSent) {
      req.__gwRetries = (req.__gwRetries || 0) + 1;
      if (req.__gwRetries <= 2) {
        console.log(`[ibkr] retry ${req.__gwRetries} after ${err.code || 'parse error'}: ${req.url}`);
        return ibkrProxy(req, res, () => {});
      }
    }
    console.error('[ibkr] proxy error:', err.message);
    if (res && !res.headersSent) {
      res.statusCode = 502;
      res.end('IBKR Gateway connection failed');
    }
  },
});

// ---- clients this gateway will not serve -------------------------------------
// The gateway holds ONE login flow at a time. A second person's browser parked
// on the login page, re-posting /sso/Authenticator every few seconds, competes
// for that flow — and the owner's own two-factor response then comes back
// "wrong", because the attempt it belonged to was replaced mid-way. Seen live
// on 2026-10-26: one address posting /sso/Authenticator every 3 seconds while
// the owner was trying to sign in.
//
// GATEWAY_BLOCK_IPS is a comma-separated list of client addresses to refuse
// outright. It is a stop-gap for exactly that case; the real fix is giving that
// person their own gateway.
const BLOCKED_IPS = new Set(
  (process.env.GATEWAY_BLOCK_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
);
const blockLogged = new Map();
app.use((req, res, next) => {
  if (BLOCKED_IPS.size === 0) return next();
  // Read it BEFORE onProxyReq strips the forwarding headers.
  const client = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!client || !BLOCKED_IPS.has(client)) return next();
  // One line a minute per address — enough to see it, not a flood of its own.
  if (Date.now() - (blockLogged.get(client) ?? 0) > 60_000) {
    blockLogged.set(client, Date.now());
    console.log(`[ibkr] refused ${client} (GATEWAY_BLOCK_IPS)`);
  }
  res.status(403).type('text/plain').send('This gateway is not available from your connection.');
});

// ---- "someone is logging in right now" ---------------------------------------
// The keepalive below revives a dead brokerage session with
// `ssodh/init {compete:true}`, and compete means TAKE THE SESSION from whoever
// holds it. That is right when the holder is a stale server-side session. It is
// exactly wrong while a person is standing at backend.nassphx.com waiting on
// their phone, because the half-built session it takes is THEIRS.
//
// Seen live 2026-11-09: the SSO had been dead since the 4th, the keepalive ran
// init every 60s, and every login attempt was killed inside the minute — the
// 2FA was approved, the page bounced back to the password form, and the bridge
// never came up. These paths are the gateway's own login flow; a hit on one
// from a browser means hands are on it, so the keepalive stands down.
const LOGIN_PATHS = /\/sso\/(Login|Authenticator|Dispatcher|Validate)\b/i;
const LOGIN_GRACE_MS = 3 * 60_000;
let lastHumanLoginAt = 0;
app.use((req, res, next) => {
  if (req.headers['x-forwarded-for'] && LOGIN_PATHS.test(req.path)) lastHumanLoginAt = Date.now();
  next();
});

// ---- ssodh/init storm guard --------------------------------------------------
// Every browser tab that sees a transient 401 fires `ssodh/init {compete:true}`,
// and each one RE-INITIALIZES the brokerage session — so several tabs (or a
// second user pointed at this gateway) bounce the session off each other all
// day. Observed live: 12,000+ init calls in three days and constant flapping.
// The gateway only ever needs ONE init per minute: forward the first, replay a
// synthetic OK to everyone else. The server-side keepalive is exempt — it
// arrives directly on localhost with no X-Forwarded-For.
const INIT_PATH = /\/v1\/api\/iserver\/auth\/ssodh\/init$/;
const INIT_MIN_GAP_MS = 60_000;
let lastInitAt = 0;
app.use((req, res, next) => {
  if (req.method !== 'POST' || !INIT_PATH.test(req.path)) return next();
  const fromBrowser = !!req.headers['x-forwarded-for'];
  const since = Date.now() - lastInitAt;
  // Right after a sign-in the init is the one that BUILDS the bridge, so it
  // must go through even if the keepalive used up this minute's slot. Only the
  // idle-tab storm this guard was written for gets replayed a synthetic answer.
  const justLoggedIn = Date.now() - lastHumanLoginAt < LOGIN_GRACE_MS;
  if (fromBrowser && !justLoggedIn && since < INIT_MIN_GAP_MS) {
    console.log(`[ibkr] ssodh/init throttled (${Math.round(since / 1000)}s since last)`);
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Content-Type', 'application/json');
    // Answer with the session's ACTUAL state (same shape ssodh/init returns),
    // so a throttled tab still learns the truth instead of a falsy stub.
    return fetch(`http://localhost:${GATEWAY_PORT}/v1/api/iserver/auth/status`, {
      method: 'POST',
      headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0', cookie: req.headers.cookie || '' },
    })
      .then((r) => r.text())
      .then((t) => res.status(200).send(t && t.trim().startsWith('{') ? t : JSON.stringify({ throttled: true })))
      .catch(() => res.status(200).send(JSON.stringify({ throttled: true })));
  }
  lastInitAt = Date.now();
  return next();
});

// ---- market-data fan-in ------------------------------------------------------
// Every open tab polls the same contracts several times a second — the ticker
// asks for the whole universe every 3s, the alerts page for its own symbols
// every 3s, the trade popup every 3s — and keep-alive to the gateway is off on
// purpose (see gatewayAgent), so each poll opened a CONNECTION OF ITS OWN.
//
// The gateway is a single Java process. Measured from outside on 2026-11-02,
// with the app open, successive snapshot calls took 1s → 2s → 7s → 14s and then
// stopped answering altogether (3 of 14 never replied). That is what "the price
// is not updating" looks like from the browser: the request is still open.
//
// So identical reads now share ONE gateway call. A request that arrives while
// the same URL is already in flight waits for that answer instead of opening
// its own connection, and the result is reused for a short TTL afterwards — a
// quote cannot be fresher than the round trip out to the browser anyway.
//
// Scope is deliberately tiny: read-only market data and contract lookups. Each
// caller's cookie is part of the key, so nothing is ever shared across logins.
// Orders, positions, auth and anything with a body go straight to the gateway
// as before, and ANY error, timeout or non-200 falls through to the normal
// proxy path — this can only ever save work, never change an answer.
const SNAPSHOT_TTL_MS = Number(process.env.MD_CACHE_MS || 900);
const CONID_TTL_MS = 10 * 60_000; // a contract id for a symbol does not move
const GW_TIMEOUT_MS = Number(process.env.GW_TIMEOUT_MS || 8_000);

function sharedTtl(req) {
  if (req.method !== 'GET') return 0;
  const p = req.path || '';
  if (p === '/v1/api/iserver/marketdata/snapshot') return SNAPSHOT_TTL_MS;
  if (p === '/v1/api/trsrv/stocks') return CONID_TTL_MS;
  return 0;
}

const mdCache = new Map(); // key -> { at, status, type, body }
const mdInflight = new Map(); // key -> Promise

function gatewayGet(url, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: GATEWAY_PORT,
        path: url,
        method: 'GET',
        agent: gatewayAgent,
        headers: {
          accept: headers.accept || 'application/json',
          'user-agent': headers['user-agent'] || 'Mozilla/5.0',
          ...(headers.cookie ? { cookie: headers.cookie } : {}),
        },
      },
      (gr) => {
        const chunks = [];
        gr.on('data', (c) => chunks.push(c));
        gr.on('end', () =>
          resolve({
            status: gr.statusCode,
            type: gr.headers['content-type'] || 'application/json',
            body: Buffer.concat(chunks),
          }));
      },
    );
    // Without this a stuck request holds its connection until the gateway feels
    // like closing it, which is exactly how the pile-up above builds.
    r.setTimeout(GW_TIMEOUT_MS, () => r.destroy(new Error('gateway timeout')));
    r.on('error', reject);
    r.end();
  });
}

function sendShared(req, res, hit, how) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Content-Type', hit.type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Nova-Shared', how); // visible in devtools when checking this
  res.status(hit.status).send(hit.body);
}

app.use((req, res, next) => {
  const ttl = sharedTtl(req);
  if (!ttl) return next();

  // Keyed by caller: two different logins never read each other's answer.
  const who = req.headers.cookie ? String(req.headers.cookie).length + ':' + String(req.headers.cookie).slice(-24) : 'none';
  const key = `${who}|${req.originalUrl}`;
  const hit = mdCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return sendShared(req, res, hit, 'hit');

  let p = mdInflight.get(key);
  if (!p) {
    p = gatewayGet(req.originalUrl, req.headers).finally(() => mdInflight.delete(key));
    mdInflight.set(key, p);
  }
  p.then(
    (out) => {
      if (res.headersSent) return;
      if (out.status === 200) {
        if (mdCache.size > 400) mdCache.clear(); // bounded; it refills in a second
        mdCache.set(key, { at: Date.now(), ...out });
        return sendShared(req, res, { ...out, at: Date.now() }, 'miss');
      }
      // The gateway said something other than OK (a session flap, usually).
      // A seconds-old quote beats an error on screen; otherwise let the real
      // proxy try, so the caller still sees the gateway's own answer.
      if (hit && Date.now() - hit.at < ttl * 20) return sendShared(req, res, hit, 'stale');
      return next();
    },
    () => {
      if (res.headersSent) return;
      if (hit) return sendShared(req, res, hit, 'stale-error');
      return next();
    },
  );
});

// Everything else (login UI at /, /v1/api, /sso, static assets, websockets) -> gateway
app.use('/', ibkrProxy);

// ---- Server-side session keepalive ------------------------------------------
// Browsers throttle timers in background tabs, so the web app's own 60s tickle
// stops the moment the user switches tabs — and the gateway drops idle sessions
// after a few minutes. Keep the session alive HERE, 24/7: tickle every 60s and,
// if the brokerage session went idle, revive it (ssodh/init + reauthenticate).
// The session then lasts until IBKR's own SSO expiry (~daily), which is the one
// thing that still needs a human login at backend.nassphx.com.
// NOTE: goes through THIS proxy (not raw :7175) — the gateway rejects some
// direct localhost calls (tickle/auth-status return Akamai "Bad Request") but
// accepts them with the proxy's header handling.
const GW = `http://127.0.0.1:${PORT}/v1/api`;

async function gw(path, body) {
  const res = await fetch(`${GW}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { ok: res.ok, json };
}

let keepaliveBusy = false;
let lastDeadSsoLog = 0;
async function establishBridge(reason) {
  console.log(`[keepalive] ${reason} — re-establishing brokerage bridge`);
  await gw('/iserver/reauthenticate').catch(() => {});
  await gw('/iserver/auth/ssodh/init', JSON.stringify({ publish: true, compete: true })).catch(() => {});
  // Prime accounts + warm the market-data farm so real-time prices flow again
  // (a re-auth alone leaves /accounts 400 and snapshots empty for a moment).
  await fetch(`${GW}/iserver/accounts`).catch(() => {});
}

async function keepalive() {
  if (keepaliveBusy) return;
  keepaliveBusy = true;
  try {
    await gw('/tickle').catch(() => {});
    // Check the brokerage session EVERY cycle (60s), not every 5 min. Tickle
    // keeps the SSO cookie alive, but the brokerage/market-data bridge drops
    // independently — auth flips to authenticated:false while the SSO is still
    // valid. That's what shows the app "Disconnected" on stale, delayed prices.
    // A live trader must never sit on a dead feed for minutes, so re-establish
    // the instant it's down.
    const st = await gw('/iserver/auth/status').catch(() => null);
    const s = st && st.json;

    // Hands on the login page — do not compete for the session they are
    // building. Tickle only; the next cycle picks it up once they are through.
    const sinceLogin = Date.now() - lastHumanLoginAt;
    if (sinceLogin < LOGIN_GRACE_MS) {
      console.log(`[keepalive] login in progress (${Math.round(sinceLogin / 1000)}s ago) — not competing`);
      return;
    }

    // The gateway says this SSO is no longer a valid login. No amount of
    // re-init fixes that — only a human signing in again does — and each
    // attempt to force it destroys the session a person may be mid-way
    // through building. So: stop, and say so once every ten minutes.
    if (s && typeof s.fail === 'string' && /invalid_username_or_password/i.test(s.fail)) {
      if (Date.now() - lastDeadSsoLog > 10 * 60_000) {
        lastDeadSsoLog = Date.now();
        console.log('[keepalive] SSO rejected by the broker — a human must sign in at backend.nassphx.com');
      }
      return;
    }

    if (s && !s.authenticated) {
      // SSO alive (tickle ok) but brokerage session not authenticated — covers
      // BOTH connected:false and connected:true (the old code only handled the
      // connected:true case, so a full drop stayed dead until manual revival).
      await establishBridge(`session down (auth=${s.authenticated} conn=${s.connected})`);
    } else if (s && s.authenticated) {
      // Authenticated, but a FRESH login can leave the bridge uninitialized
      // ("no bridge" 400s on /accounts) until someone runs ssodh/init.
      const acc = await fetch(`${GW}/iserver/accounts`).then((r) => r.status).catch(() => 0);
      if (acc === 400 || acc === 401) await establishBridge('bridge down after login');
    }
  } catch (_) {
    // gateway down or SSO fully expired — nothing to do until someone logs in
  } finally {
    keepaliveBusy = false;
  }
}
setInterval(keepalive, 60_000);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 IBKR Proxy Server running on port ${PORT}`);
  console.log(`📡 Proxying requests to IBKR Gateway at localhost:${GATEWAY_PORT}`);
  keepalive(); // first ping once we can route through ourselves
});

// Proxy websocket upgrades too (market-data streaming)
server.on('upgrade', ibkrProxy.upgrade);
