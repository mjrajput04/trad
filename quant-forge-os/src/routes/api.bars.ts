import { json, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const days = parseInt(url.searchParams.get("days") || "1");

  if (!symbol) {
    return json({ error: "Symbol required" }, { status: 400 });
  }

  try {
    // Generate mock OHLCV data
    const bars = [];
    const now = Date.now();
    const interval = days === 1 ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000; // 5min or 1day
    const numBars = days === 1 ? 78 : days * 1; // 78 bars for 1D (6.5 hours), 1 bar per day otherwise
    
    let basePrice = 150 + Math.random() * 50;
    
    for (let i = 0; i < numBars; i++) {
      const t = now - (numBars - i) * interval;
      const volatility = 0.02;
      const change = (Math.random() - 0.5) * basePrice * volatility;
      
      const open = basePrice;
      const close = basePrice + change;
      const high = Math.max(open, close) + Math.random() * basePrice * 0.01;
      const low = Math.min(open, close) - Math.random() * basePrice * 0.01;
      const volume = Math.floor(Math.random() * 1000000) + 500000;
      
      bars.push({
        t,
        o: parseFloat(open.toFixed(2)),
        h: parseFloat(high.toFixed(2)),
        l: parseFloat(low.toFixed(2)),
        c: parseFloat(close.toFixed(2)),
        v: volume,
      });
      
      basePrice = close;
    }

    return json(bars);
  } catch (error) {
    console.error("Bars fetch error:", error);
    return json({ error: "Failed to fetch bars" }, { status: 500 });
  }
}
