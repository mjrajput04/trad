// Script to fetch real CONIDs from IBKR API
const https = require('https');

// Disable SSL verification for localhost
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META', 'JPM',
  'V', 'AVGO', 'UNH', 'NFLX', 'AMD', 'INTC', 'BABA', 'DIS', 'BA', 'GE',
  'WMT', 'PG', 'JNJ', 'HD', 'CVX', 'LLY', 'XOM', 'ABBV', 'PFE', 'KO',
  'COST', 'ADBE', 'CRM', 'ORCL', 'ACN', 'TMO', 'VZ', 'CSCO', 'PEP',
  'QCOM', 'TXN', 'INTU', 'IBM', 'CAT', 'GS', 'AXP', 'HON', 'NEE'
];

async function fetchCONID(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://backend.nassphx.com/v1/api/iserver/secdef/search?symbol=${symbol}&name=false&secType=STK`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.length > 0) {
            const result = {
              symbol: symbol,
              conid: parsed[0].conid,
              description: parsed[0].description || symbol,
              exchange: parsed[0].exchange || 'NASDAQ'
            };
            console.log(`${symbol}: ${result.conid} (${result.description})`);
            resolve(result);
          } else {
            console.warn(`No data for ${symbol}`);
            resolve(null);
          }
        } catch (error) {
          console.error(`Parse error for ${symbol}:`, error.message);
          resolve(null);
        }
      });
    }).on('error', (error) => {
      console.error(`Request error for ${symbol}:`, error.message);
      resolve(null);
    });
  });
}

async function fetchAllCONIDs() {
  console.log('Fetching CONIDs from IBKR API...\n');
  
  const results = {};
  
  for (const symbol of SYMBOLS) {
    try {
      const result = await fetchCONID(symbol);
      if (result) {
        results[symbol] = result.conid;
      }
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching ${symbol}:`, error);
    }
  }
  
  console.log('\n=== CONIDS MAPPING ===');
  console.log('export const CONIDS: Record<string, number> = {');
  Object.entries(results).forEach(([symbol, conid]) => {
    console.log(`  ${symbol}: ${conid},`);
  });
  console.log('};');
  
  return results;
}

// Run the script
fetchAllCONIDs().catch(console.error);