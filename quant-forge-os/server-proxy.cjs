const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8001;

// Enable CORS for specific origins with credentials
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://nassphx.com',
      'https://www.nassphx.com', 
      'http://localhost:8081',
      'http://localhost:8080',
      'http://localhost:3000'
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

// Middleware to handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With');
  res.sendStatus(200);
});

// Proxy configuration for IBKR API
const ibkrProxy = createProxyMiddleware({
  target: 'http://localhost:7175', // Use HTTP internally
  changeOrigin: true,
  secure: false,
  logLevel: 'debug',
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying request: ${req.method} ${req.url}`);
    
    // Forward all headers including cookies
    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }
    
    // Set proper headers for IBKR
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
  },
  
  onProxyRes: (proxyRes, req, res) => {
    console.log(`Response: ${proxyRes.statusCode} for ${req.url}`);
    
    // Set CORS headers on response
    const origin = req.headers.origin;
    if (origin) {
      proxyRes.headers['Access-Control-Allow-Origin'] = origin;
      proxyRes.headers['Access-Control-Allow-Credentials'] = 'true';
    }
    
    // Forward cookies properly
    if (proxyRes.headers['set-cookie']) {
      proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(cookie => {
        // Modify cookie domain if needed
        return cookie.replace(/Domain=localhost/gi, `Domain=${req.headers.host}`);
      });
    }

    // Rewrite absolute gateway redirects to relative so the login flow works behind the proxy
    if (proxyRes.headers['location']) {
      proxyRes.headers['location'] = proxyRes.headers['location'].replace(/^https?:\/\/localhost:7175/i, '');
    }
  },
  
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'IBKR Gateway connection failed' });
  }
});

// Health check (define before the catch-all proxy below)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Proxy everything else to the IBKR Gateway. This serves the gateway login UI
// at https://backend.nassphx.com/ as well as all API paths (/v1/api, /sso,
// static assets) through the same CORS-enabled proxy.
app.use('/', ibkrProxy);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 IBKR Proxy Server running on port ${PORT}`);
  console.log(`📡 Proxying requests to IBKR Gateway at localhost:7175`);
});