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
const GW = 'http://localhost:7175/v1/api';

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
let keepaliveCycles = 0;
async function keepalive() {
  if (keepaliveBusy) return;
  keepaliveBusy = true;
  try {
    await gw('/tickle').catch(() => {});
    // Every 5 minutes also check the brokerage session and revive it if idle.
    if (++keepaliveCycles % 5 === 0) {
      const st = await gw('/iserver/auth/status').catch(() => null);
      const s = st && st.json;
      if (s && s.connected && !s.authenticated) {
        console.log('[keepalive] brokerage session idle — reviving');
        await gw('/iserver/auth/ssodh/init', JSON.stringify({ publish: true, compete: true })).catch(() => {});
        await gw('/iserver/reauthenticate').catch(() => {});
      } else if (s && s.authenticated) {
        // SSO is up, but a FRESH login leaves the brokerage bridge
        // uninitialized ("no bridge" 400s) until someone runs ssodh/init.
        // Do it here so the app is ready even if no tab is open.
        const acc = await fetch(`${GW}/iserver/accounts`).then((r) => r.status).catch(() => 0);
        if (acc === 400 || acc === 401) {
          console.log('[keepalive] bridge down after login — initializing');
          await gw('/iserver/auth/ssodh/init', JSON.stringify({ publish: true, compete: true })).catch(() => {});
          await gw('/iserver/reauthenticate').catch(() => {});
        }
      }
    }
  } catch (_) {
    // gateway down or SSO fully expired — nothing to do until someone logs in
  } finally {
    keepaliveBusy = false;
  }
}
setInterval(keepalive, 60_000);
keepalive();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 IBKR Proxy Server running on port ${PORT}`);
  console.log(`📡 Proxying requests to IBKR Gateway at localhost:7175`);
});

// Proxy websocket upgrades too (market-data streaming)
server.on('upgrade', ibkrProxy.upgrade);
