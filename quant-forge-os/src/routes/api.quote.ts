import { json, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");

  if (!symbol) {
    return json({ error: "Symbol required" }, { status: 400 });
  }

  try {
    // Mock data - replace with actual IBKR API call
    const mockQuote = {
      symbol,
      last: 150 + Math.random() * 50,
      open: 145 + Math.random() * 50,
      high: 155 + Math.random() * 50,
      low: 140 + Math.random() * 50,
      prevClose: 148 + Math.random() * 50,
      volume: Math.floor(Math.random() * 10000000) + 5000000,
      bid: 149 + Math.random() * 50,
      ask: 151 + Math.random() * 50,
      timestamp: Date.now(),
    };

    return json(mockQuote);
  } catch (error) {
    console.error("Quote fetch error:", error);
    return json({ error: "Failed to fetch quote" }, { status: 500 });
  }
}
