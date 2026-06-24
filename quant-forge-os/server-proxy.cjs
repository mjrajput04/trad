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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 IBKR Proxy Server running on port ${PORT}`);
  console.log(`📡 Proxying requests to IBKR Gateway at localhost:7175`);
});

// Proxy websocket upgrades too (market-data streaming)
server.on('upgrade', ibkrProxy.upgrade);
