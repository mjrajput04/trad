const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8001;

// Origins allowed to make credentialed cross-site calls (the web app).
// Same-origin browser navigation to backend.nassphx.com sends no Origin header
// and is always allowed.
const ALLOWED_ORIGINS = ['https://nassphx.com', 'https://www.nassphx.com'];

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
const ibkrProxy = createProxyMiddleware({
  target: 'http://localhost:7175',
  changeOrigin: true,
  secure: false,
  ws: true,
  logLevel: 'warn',
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
        /^https?:\/\/localhost:7175/i,
        ''
      );
    }
  },
  onError: (err, req, res) => {
    console.error('[ibkr] proxy error:', err.message);
    if (res && !res.headersSent) {
      res.statusCode = 502;
      res.end('IBKR Gateway connection failed');
    }
  },
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
  console.log(`📡 Proxying requests to IBKR Gateway at localhost:7175`);
  keepalive(); // first ping once we can route through ourselves
});

// Proxy websocket upgrades too (market-data streaming)
server.on('upgrade', ibkrProxy.upgrade);
