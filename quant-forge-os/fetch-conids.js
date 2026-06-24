import https from 'https';

// Disable SSL verification for localhost
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const symbols = [
  // Major Tech Stocks
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'NFLX', 'AMD', 'INTC', 'ORCL', 'ADBE', 'CRM',
  // Financial Stocks  
  'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'AXP',
  // Healthcare & Pharma
  'UNH', 'JNJ', 'PFE', 'ABBV', 'LLY', 'TMO',
  // Industrial & Energy
  'AVGO', 'BA', 'CAT', 'GE', 'XOM', 'CVX',
  // Consumer & Retail
  'WMT', 'HD', 'PG', 'KO', 'PEP', 'COST', 'DIS',
  // Telecom & Utilities
  'VZ', 'T', 'CSCO', 'NEE',
  // Semiconductors
  'QCOM', 'TXN', 'INTU',
  // Other Major Stocks
  'IBM', 'BABA', 'HON', 'ACN'
];

async function fetchConid(symbol) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'backend.nassphx.com',
      port: 443,
      path: `/v1/api/iserver/secdef/search?symbol=${symbol}&name=false&secType=STK`,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      method: 'GET',
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.length > 0 && parsed[0].conid) {
            console.log(`${symbol}: ${parsed[0].conid}`);
            resolve({ symbol, conid: parsed[0].conid, name: parsed[0].description });
          } else {
            console.log(`${symbol}: NOT FOUND`);
            resolve({ symbol, conid: null, name: null });
          }
        } catch (e) {
          console.log(`${symbol}: ERROR - ${e.message}`);
          resolve({ symbol, conid: null, name: null });
        }
      });
    });

    req.on('error', (e) => {
      console.log(`${symbol}: ERROR - ${e.message}`);
      resolve({ symbol, conid: null, name: null });
    });

    req.setTimeout(5000, () => {
      console.log(`${symbol}: TIMEOUT`);
      req.destroy();
      resolve({ symbol, conid: null, name: null });
    });

    req.end();
  });
}

async function fetchAllConids() {
  console.log('Fetching CONIDs from IBKR Client Portal...\n');
  
  const results = [];
  
  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(fetchConid));
    results.push(...batchResults);
    
    // Wait between batches
    if (i + 5 < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n=== RESULTS ===');
  console.log('export const CONIDS: Record<string, number> = {');
  
  results.forEach(({ symbol, conid, name }) => {
    if (conid) {
      console.log(`  ${symbol}: ${conid}, // ${name}`);
    } else {
      console.log(`  // ${symbol}: NOT_FOUND`);
    }
  });
  
  console.log('};');
  
  // Also create a summary
  const found = results.filter(r => r.conid).length;
  const notFound = results.filter(r => !r.conid).length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`Found: ${found}`);
  console.log(`Not Found: ${notFound}`);
  console.log(`Total: ${results.length}`);
}

fetchAllConids().catch(console.error);