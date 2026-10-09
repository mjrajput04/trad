// Fetch 5m (60d) + 1d (1y) Yahoo bars for a broad liquid universe → data/*.json
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "data");
fs.mkdirSync(DIR, { recursive: true });

const U = `AAPL MSFT NVDA AMZN META GOOGL TSLA AMD AVGO ORCL NFLX CRM ADBE INTC QCOM MU TXN AMAT LRCX KLAC
MRVL ON MCHP NXPI ADI SMCI ARM DELL HPQ HPE IBM CSCO ANET PANW CRWD ZS FTNT NET DDOG SNOW MDB
PLTR SHOP UBER LYFT ABNB DASH RBLX U SNAP PINS TWLO OKTA DOCU ZM ROKU SPOT TTD APP HUBS TEAM WDAY NOW INTU
COIN HOOD MSTR MARA RIOT CLSK HUT BITF CIFR WULF IREN CORZ SOFI AFRM UPST PYPL SQ XYZ NU
RIVN LCID NIO XPEV LI F GM STLA FSR CHPT QS RUN ENPH SEDG FSLR PLUG BE
BABA JD PDD BIDU TCOM BILI FUTU TME
JPM BAC WFC C GS MS SCHW USB PNC COF AXP V MA
XOM CVX OXY COP DVN EOG HAL SLB APA MRO FANG
BA AAL DAL UAL LUV CCL RCL NCLH JBLU
DIS WBD PARA CMCSA T VZ TMUS CHTR
WMT TGT COST HD LOW NKE LULU SBUX MCD CMG DPZ YUM ETSY EBAY W CHWY BBY GME AMC DKS
PFE MRNA BNTX JNJ LLY NVO ABBV MRK BMY GILD AMGN BIIB REGN VRTX CVS UNH HUM CI ISRG DXCM
CAT DE GE HON MMM LMT RTX NOC GD
SPY QQQ IWM TQQQ SQQQ SOXL SOXS TNA UVXY
AI PATH SOUN BBAI IONQ RGTI QBTS QUBT RKLB ASTS LUNR ACHR JOBY
CVNA OPEN Z RDFN
DKNG PENN MGM WYNN LVS
CELH ELF ONON DECK CROX
TSM ASML SNPS CDNS WOLF
GEV VST CEG NRG OKLO SMR NNE LEU
HIMS TDOC RXRX
NKLA SPCE DNA
CLF X AA FCX NEM GOLD VALE
MU WDC STX NTAP PSTG
SE MELI GRAB
TSLL NVDL CONL MSTU`
  .split(/\s+/).filter(Boolean);
const SYMS = [...new Set(U)];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(1000); }
  }
  return null;
}
function bars(j) {
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) return [];
  const q = r.indicators.quote[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ t: r.timestamp[i], o, h, l, c, v: v || 0 });
  }
  return out;
}

(async () => {
  let done = 0, ok = 0;
  const queue = [...SYMS];
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      const f = path.join(DIR, `${s}.json`);
      if (fs.existsSync(f)) { done++; ok++; continue; }
      const [m5, d1] = await Promise.all([
        get(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=5m&range=60d`),
        get(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=1y`),
      ]);
      const a = bars(m5), b = bars(d1);
      if (a.length > 500 && b.length > 100) {
        fs.writeFileSync(f, JSON.stringify({ s, m5: a, d1: b }));
        ok++;
      }
      done++;
      if (done % 25 === 0) console.log(`${done}/${SYMS.length} ok=${ok}`);
      await sleep(250);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`DONE ${ok}/${SYMS.length}`);
})();
