import { json, type ActionFunctionArgs } from "@remix-run/node";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { symbol, side, quantity, type, limitPrice, stopPrice } = body;

    // Validate required fields
    if (!symbol || !side || !quantity || !type) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    // Mock order placement - replace with actual IBKR API call
    const order = {
      orderId: `ORD-${Date.now()}`,
      symbol,
      side,
      quantity,
      type,
      limitPrice,
      stopPrice,
      status: "submitted",
      timestamp: Date.now(),
    };

    console.log("Order placed:", order);

    return json({ success: true, order });
  } catch (error) {
    console.error("Order placement error:", error);
    return json({ error: "Failed to place order" }, { status: 500 });
  }
}
