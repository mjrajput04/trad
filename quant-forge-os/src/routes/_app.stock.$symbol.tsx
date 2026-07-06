import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Activity, Loader2, Zap, AlertTriangle, Bell, BookmarkPlus } from "lucide-react";
import { ResponsiveContainer, ComposedChart, BarChart, Line, Area, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, ReferenceArea } from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChartDrawingTools, AdvancedIndicators, enhanceDataWithIndicators, type DrawingTool, type Drawing } from "@/components/ChartTools";
import { CandlestickChart } from "@/components/CandlestickChart";
import { getChartData, getQuotes, getConid, placeOrder as submitIbkrOrder } from "@/lib/api/ibkr";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/stock/$symbol")({
  component: StockDetail,
});

const PERIODS = [
  { label: "1D", days: 1, period: "1d", bar: "2min" },
  { label: "5D", days: 5, period: "1w", bar: "15min" },
  { label: "1M", days: 30, period: "1m", bar: "1h" },
  { label: "6M", days: 180, period: "6m", bar: "4h" },
  { label: "1Y", days: 365, period: "1y", bar: "1d" },
];

const CHART_TYPES = ["Line", "Candlestick", "Area"] as const;
const INDICATORS = ["SMA", "EMA", "BB", "RSI", "MACD", "ATR", "OBV", "Volume"] as const;

function StockDetail() {
  const { symbol } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [conid, setConid] = useState<number | null>(null);
  const [conidFailed, setConidFailed] = useState(false);
  const [orderPending, setOrderPending] = useState(false);
  const [activePeriod, setActivePeriod] = useState(PERIODS[0]);
  const [chartType, setChartType] = useState<typeof CHART_TYPES[number]>("Candlestick");
  const [indicators, setIndicators] = useState<string[]>(["Volume"]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("100");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [activeTool, setActiveTool] = useState<DrawingTool>("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartContainerRef, setChartContainerRef] = useState<HTMLDivElement | null>(null);
  const [yDomain, setYDomain] = useState<[number, number]>([0, 0]);
  const [viewWindow, setViewWindow] = useState({ start: 0, end: 100 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanX, setLastPanX] = useState(0);

  // Resolve the IBKR contract id for this symbol (works for any US stock).
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setConid(null);
    setConidFailed(false);
    setLoading(true);
    // Clear the previous symbol's data so it never flashes on the new page.
    setChartData([]);
    setQuote(null);
    setViewWindow({ start: 0, end: 0 });
    setLimitPrice("");
    getConid(symbol as string)
      .then((id) => {
        if (cancelled) return;
        if (id) setConid(id);
        else {
          setConidFailed(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConidFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const atPresentRef = useRef(true);
  useEffect(() => {
    atPresentRef.current = viewWindow.end >= chartData.length - 5;
  }, [viewWindow, chartData.length]);

  useEffect(() => {
    if (!conid) return;
    setLoading(true);
    fetchQuote(conid);
    fetchChartData(conid);
    const quoteInterval = setInterval(() => fetchQuote(conid), 2_000);
    const chartInterval = setInterval(() => {
      // Only auto-refresh chart if we are at the "present" (end of data)
      if (atPresentRef.current) fetchChartData(conid);
    }, 30_000);
    return () => {
      clearInterval(quoteInterval);
      clearInterval(chartInterval);
    };
  }, [conid, activePeriod]);

  useEffect(() => {
    if (chartData.length > 0 && viewWindow.end === 0) {
      // Initial view: show last 100 points
      const count = activePeriod.label === "1D" ? 78 : 100;
      setViewWindow({
        start: Math.max(0, chartData.length - count),
        end: chartData.length
      });
    }
  }, [chartData]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!chartData.length) return;
    e.preventDefault();
    
    const zoomFactor = 0.15;
    const direction = e.deltaY > 0 ? 1 : -1; // positive = zoom out, negative = zoom in
    const currentCount = viewWindow.end - viewWindow.start;
    const change = Math.round(currentCount * zoomFactor * direction);
    
    // Zoom from both sides to keep center relatively stable
    const halfChange = Math.floor(change / 2);
    let newStart = Math.max(0, viewWindow.start + halfChange);
    let newEnd = Math.min(chartData.length, viewWindow.end - halfChange);
    
    // Ensure minimum 10 candles
    if (newEnd - newStart < 10) {
      if (newStart === 0) newEnd = 10;
      else newStart = newEnd - 10;
    }

    setViewWindow({ start: newStart, end: newEnd });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool !== "none") return;
    setIsPanning(true);
    setLastPanX(e.clientX);
    // Prevent interaction with drawing tools while panning
    e.stopPropagation();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !chartData.length) return;
    
    const deltaX = e.clientX - lastPanX;
    if (Math.abs(deltaX) < 2) return; 

    const pointsPerPixel = (viewWindow.end - viewWindow.start) / (chartContainerRef?.offsetWidth || 800);
    const shift = Math.round(-deltaX * pointsPerPixel);
    
    if (shift === 0) return;

    let newStart = viewWindow.start + shift;
    let newEnd = viewWindow.end + shift;

    // Bounds checking
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd > chartData.length) {
      newStart -= (newEnd - chartData.length);
      newEnd = chartData.length;
    }
    
    // Final sanity check
    newStart = Math.max(0, newStart);
    newEnd = Math.min(newEnd, chartData.length);

    if (newStart !== viewWindow.start || newEnd !== viewWindow.end) {
      setViewWindow({ start: newStart, end: newEnd });
      setLastPanX(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const visibleData = chartData.slice(viewWindow.start, viewWindow.end);

  useEffect(() => {
    if (visibleData.length > 0) {
      const prices = visibleData.flatMap(d => [d.h, d.l]);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const range = max - min;
      // Add 10% padding to top and bottom
      const padding = range * 0.1 || min * 0.01; 
      setYDomain([min - padding, max + padding]);
    }
  }, [visibleData]);

  const fetchQuote = async (id: number) => {
    try {
      const data = await getQuotes([symbol as string]);
      const q = data.find((s) => s.conid === id) ?? data[0];
      if (q) {
        setQuote({
          last: q.last,
          open: q.open || q.last,
          high: q.high || q.last,
          low: q.low || q.last,
          prevClose: q.prevClose || (q.changePct ? q.last / (1 + q.changePct / 100) : q.last),
          volume: q.volume,
          bid: q.bid,
          ask: q.ask,
        });
        // Seed the limit field once, without clobbering a value the user typed.
        // (This runs inside a polling interval, so use a functional update — the
        // captured `limitPrice` closure is stale and would always look empty.)
        if (q.last) setLimitPrice((prev) => prev || q.last.toFixed(2));
      }
    } catch (err) {
      console.error("Quote fetch error:", err);
    }
  };

  const fetchChartData = async (id: number) => {
    try {
      const conid = id;
      // Request larger period to allow panning back
      const requestPeriod = activePeriod.label === "1D" ? "1w" : activePeriod.period;
      const data = await getChartData(conid, requestPeriod, activePeriod.bar);
      const enhanced = enhanceDataWithIndicators(data).map((d: any) => ({
        ...d,
        // Range for the candlestick body
        bodyRange: [d.o, d.c],
        // Range for the candlestick wick
        wickRange: [d.l, d.h],
      }));
      setChartData(enhanced);
      
      // Calculate Y domain for candlestick alignment
      if (enhanced.length > 0) {
        const yMin = Math.min(...enhanced.map(d => d.l));
        const yMax = Math.max(...enhanced.map(d => d.h));
        const padding = (yMax - yMin) * 0.05;
        setYDomain([yMin - padding, yMax + padding]);
      }
      
      setLoading(false);
    } catch (err) {
      console.error("Chart fetch error:", err);
      setLoading(false);
    }
  };



  const calculateRSI = (data: any[], idx: number, period: number) => {
    if (idx < period) return null;
    let gains = 0, losses = 0;
    for (let i = idx - period + 1; i <= idx; i++) {
      const change = data[i].c - data[i - 1]?.c || 0;
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };

  const createAlert = () => {
    const alertPrice = prompt(`Create price alert for ${symbol}:`);
    if (alertPrice) {
      setAlerts([...alerts, { price: parseFloat(alertPrice), timestamp: Date.now() }]);
    }
  };

  const addToWatchlist = () => {
    alert(`${symbol} added to watchlist!`);
  };

  const placeOrder = async () => {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    const price =
      orderType === "limit" ? parseFloat(limitPrice)
      : orderType === "stop" ? parseFloat(stopPrice)
      : undefined;
    if (orderType !== "market" && (!price || price <= 0)) {
      toast.error(`Enter a valid ${orderType} price`);
      return;
    }

    const side = orderSide === "buy" ? "BUY" : "SELL";
    const ibkrType = orderType === "market" ? "MKT" : orderType === "limit" ? "LMT" : "STP";
    const priceLabel = orderType === "market" ? "market price" : `$${price!.toFixed(2)}`;
    if (!window.confirm(`${side} ${qty} ${symbol} @ ${priceLabel} — send to IBKR?`)) return;

    setOrderPending(true);
    try {
      const result = await submitIbkrOrder({
        symbol: symbol as string,
        side,
        quantity: qty,
        orderType: ibkrType,
        price,
      });
      toast.success(`Order sent to IBKR — #${result.orderId} (${result.status})`);
      queryClient.invalidateQueries({ queryKey: ["ibkr-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ibkr-positions"] });
      queryClient.invalidateQueries({ queryKey: ["ibkr-summary"] });
    } catch (err: any) {
      console.error("Order error:", err);
      toast.error(err?.message ?? "Order failed");
    } finally {
      setOrderPending(false);
    }
  };

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);

  // Reset drawing state when tool changes
  useEffect(() => {
    setIsDrawing(false);
    setCurrentDrawing(null);
  }, [activeTool]);

  const handleChartMouseDown = (e: any) => {
    if (activeTool === "none" || !e) return;
    
    // Get time from activeLabel (X-axis)
    const t = e.activeLabel;
    
    // Calculate price from chartY (Y-axis)
    // We use the chartContainerRef and yDomain to manually invert the Y coordinate
    const chartHeight = 260 - 30; // height - margins
    const yOffset = e.chartY - 10; // chartY - top margin
    const priceRange = yDomain[1] - yDomain[0];
    const p = yDomain[1] - (yOffset / chartHeight) * priceRange;

    if (!t || isNaN(p)) return;

    const point = { t, p };

    if (!isDrawing) {
      const newDrawing: Drawing = {
        id: Math.random().toString(36).substr(2, 9),
        type: activeTool,
        points: [point, point],
        color: "oklch(0.74 0.18 235)",
      };
      setIsDrawing(true);
      setCurrentDrawing(newDrawing);
    } else {
      if (currentDrawing) {
        setDrawings([...drawings, {
          ...currentDrawing,
          points: [currentDrawing.points[0], point]
        }]);
      }
      setIsDrawing(false);
      setCurrentDrawing(null);
    }
  };

  const handleChartMouseMove = (e: any) => {
    if (!isDrawing || !currentDrawing || !e) return;
    
    const t = e.activeLabel;
    const chartHeight = 260 - 30;
    const yOffset = e.chartY - 10;
    const priceRange = yDomain[1] - yDomain[0];
    const p = yDomain[1] - (yOffset / chartHeight) * priceRange;

    if (!t || isNaN(p)) return;

    setCurrentDrawing({
      ...currentDrawing,
      points: [currentDrawing.points[0], { t, p }],
    });
  };

  const handleChartMouseUp = () => {
    // Logic moved to handleChartMouseDown for 2-click system
  };

  const renderDrawings = () => {
    const allDrawings = [...drawings];
    if (currentDrawing) allDrawings.push(currentDrawing);

    return allDrawings.map((drawing) => {
      const p1 = drawing.points[0];
      const p2 = drawing.points[1];

      if (drawing.type === "vertical") {
        return (
          <ReferenceLine
            key={drawing.id}
            x={p1.t}
            stroke={drawing.color}
            strokeWidth={2}
            strokeDasharray="3 3"
          />
        );
      }
      if (drawing.type === "fib") {
        const diff = p1.p - p2.p;
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        return (
          <g key={drawing.id}>
            {levels.map((lvl) => (
              <ReferenceLine
                key={`${drawing.id}-${lvl}`}
                y={p1.p - diff * lvl}
                stroke={drawing.color}
                strokeWidth={1}
                strokeDasharray="3 3"
                label={{
                  value: `${(lvl * 100).toFixed(1)}% ($${(p1.p - diff * lvl).toFixed(2)})`,
                  position: "insideLeft",
                  fill: drawing.color,
                  fontSize: 9,
                  fontWeight: "bold",
                }}
              />
            ))}
          </g>
        );
      }
      if (drawing.type === "trendline") {
        return (
          <ReferenceArea
            key={drawing.id}
            x1={p1.t}
            x2={p2.t}
            y1={p1.p}
            y2={p2.p}
            stroke="none"
            fill="none"
            shape={(props: any) => {
              const { x: x1, y: y1, width, height } = props;
              const x2 = x1 + width;
              const y2 = y1 + height;
              
              const startX = p1.t <= p2.t ? x1 : x2;
              const endX = p1.t <= p2.t ? x2 : x1;
              const startY = p1.p >= p2.p ? y1 : y2;
              const endY = p1.p >= p2.p ? y2 : y1;

              if (width < 2 && height < 2 && !isDrawing) return <g />;

              return (
                <line 
                  x1={startX} y1={startY} 
                  x2={endX} y2={endY} 
                  stroke={drawing.color} strokeWidth={2} 
                />
              );
            }}
          />
        );
      }
      if (drawing.type === "horizontal") {
        return (
          <ReferenceLine
            key={drawing.id}
            y={p1.p}
            stroke={drawing.color}
            strokeWidth={2}
            strokeDasharray="3 3"
          />
        );
      }
      if (drawing.type === "rectangle") {
        const t1 = Math.min(p1.t, p2.t);
        const t2 = Math.max(p1.t, p2.t);
        const v1 = Math.min(p1.p, p2.p);
        const v2 = Math.max(p1.p, p2.p);
        return (
          <ReferenceArea
            key={drawing.id}
            x1={t1}
            x2={t2}
            y1={v1}
            y2={v2}
            stroke={drawing.color}
            strokeWidth={1.5}
            fill={drawing.color}
            fillOpacity={0.15}
          />
        );
      }
      if (drawing.type === "circle") {
        const centerX = p1.t;
        const centerY = p1.p;
        // Simple circle approximation using ReferenceArea with rounded corners isn't possible,
        // so we use a ReferenceArea with a custom shape or just a highlighted region
        return (
          <ReferenceArea
            key={drawing.id}
            x1={p1.t}
            x2={p2.t}
            y1={p1.p}
            y2={p2.p}
            stroke={drawing.color}
            strokeWidth={1.5}
            fill={drawing.color}
            fillOpacity={0.15}
            shape={(props: any) => {
              const { x, y, width, height } = props;
              const rx = width / 2;
              const ry = height / 2;
              const cx = x + rx;
              const cy = y + ry;
              return (
                <ellipse 
                  cx={cx} cy={cy} rx={Math.abs(rx)} ry={Math.abs(ry)} 
                  fill={drawing.color} fillOpacity={0.15} 
                  stroke={drawing.color} strokeWidth={1.5} 
                />
              );
            }}
          />
        );
      }
      return null;
    });
  };

  const xFormatter = (t: number) => {
    if (!t) return "";
    const d = new Date(t);
    if (activePeriod.label === "1D") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const changePct = quote ? ((quote.last - quote.prevClose) / quote.prevClose) * 100 : 0;
  const isPositive = changePct >= 0;

  if (loading && !quote) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading {symbol}...</p>
        </div>
      </div>
    );
  }

  if (conidFailed) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-warn mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Symbol Not Found</h2>
          <p className="text-muted-foreground mb-4">IBKR has no US listing for {symbol}. Check the ticker or log in to the gateway.</p>
          <button 
            onClick={() => navigate({ to: "/" })} 
            className="px-4 h-10 rounded-lg bg-primary text-white hover:bg-primary/90 transition"
          >
            Go Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate({ to: "/" })} className="p-1.5 rounded-lg hover:bg-surface-2 transition">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold">{symbol}</h1>
            {quote && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xl font-bold num">${quote.last?.toFixed(2)}</span>
                <span className={`flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-bull" : "text-bear"}`}>
                  {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {isPositive ? "+" : ""}{changePct.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={createAlert} className="px-3 h-8 rounded-lg bg-surface-2 hover:bg-surface-3 transition flex items-center gap-2 text-xs font-medium">
            <Bell className="h-3.5 w-3.5" /> Alert
          </button>
          <button onClick={addToWatchlist} className="px-3 h-8 rounded-lg bg-surface-2 hover:bg-surface-3 transition flex items-center gap-2 text-xs font-medium">
            <BookmarkPlus className="h-3.5 w-3.5" /> Watchlist
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-3">
        {/* Chart Section */}
        <div className="space-y-3">
          <div className="rounded-2xl glass p-4">
            {/* Chart Controls */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setActivePeriod(p)}
                    className={`px-2.5 h-7 rounded-md text-[10px] font-medium transition ${activePeriod.label === p.label ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-surface-2"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {CHART_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => setChartType(type)}
                    className={`px-2.5 h-7 rounded-md text-[10px] font-medium transition ${chartType === type ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-surface-2"}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Indicators */}
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {INDICATORS.map((ind) => (
                <button
                  key={ind}
                  onClick={() => setIndicators(prev => prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind])}
                  className={`px-2.5 h-6 rounded-md text-[10px] font-medium transition ${indicators.includes(ind) ? "bg-violet-500/20 text-violet-300" : "text-muted-foreground hover:bg-surface-2"}`}
                >
                  {ind}
                </button>
              ))}
            </div>

            {/* Drawing Tools */}
            <div className="mb-3">
              <ChartDrawingTools 
                activeTool={activeTool} 
                setActiveTool={setActiveTool}
                drawings={drawings}
                setDrawings={setDrawings}
              />
            </div>

            {/* Main Chart */}
            <div 
              className="h-[400px] relative cursor-crosshair select-none" 
              ref={setChartContainerRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart 
                    data={visibleData} 
                    margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
                    onMouseDown={handleChartMouseDown}
                    onMouseMove={handleChartMouseMove}
                    onMouseUp={handleChartMouseUp}
                  >
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="oklch(0.74 0.18 235)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="oklch(0.74 0.18 235)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="t" 
                      tickFormatter={xFormatter} 
                      tick={{ fontSize: 9, fill: "oklch(0.66 0.018 255)" }} 
                      axisLine={{ stroke: "oklch(1 0 0 / 10%)" }} 
                      tickLine={{ stroke: "oklch(1 0 0 / 10%)" }}
                      interval="preserveStartEnd"
                      minTickGap={30}
                    />
                    <YAxis 
                      domain={yDomain[0] !== 0 ? yDomain : ["dataMin", "dataMax"]} 
                      tick={{ fontSize: 9, fill: "oklch(0.66 0.018 255)" }} 
                      axisLine={{ stroke: "oklch(1 0 0 / 10%)" }} 
                      tickLine={{ stroke: "oklch(1 0 0 / 10%)" }} 
                      tickFormatter={(v) => `$${v.toFixed(2)}`} 
                      width={65}
                      orientation="left"
                    />
                    <Tooltip
                      cursor={activeTool === "none" ? { stroke: "oklch(0.74 0.18 235)", strokeWidth: 1, strokeDasharray: "3 3" } : false}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length && activeTool === "none") {
                          const d = payload[0].payload;
                          return (
                            <div className="rounded-lg glass p-3 hairline text-[11px] shadow-2xl min-w-[140px]">
                              <div className="font-bold text-[oklch(0.9_0_0)] mb-2">
                                {new Date(d.t).toLocaleString("en-US", { 
                                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" 
                                })}
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <span className="text-muted-foreground">Open</span>
                                <span className="text-foreground font-mono text-right">${d.o.toFixed(2)}</span>
                                <span className="text-muted-foreground">High</span>
                                <span className="text-bull font-mono text-right">${d.h.toFixed(2)}</span>
                                <span className="text-muted-foreground">Low</span>
                                <span className="text-bear font-mono text-right">${d.l.toFixed(2)}</span>
                                <span className="text-muted-foreground">Close</span>
                                <span className="text-foreground font-mono text-right font-bold">${d.c.toFixed(2)}</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />

                    {renderDrawings()}
                    
                    {chartType === "Line" && (
                      <Line type="monotone" dataKey="c" stroke="oklch(0.74 0.18 235)" strokeWidth={2} dot={false} />
                    )}
                    
                    {chartType === "Area" && (
                      <Area type="monotone" dataKey="c" stroke="oklch(0.74 0.18 235)" strokeWidth={2} fill="url(#areaGrad)" dot={false} />
                    )}
                    
                    {chartType === "Candlestick" && (
                      <Bar 
                        dataKey="bodyRange" 
                        isAnimationActive={false}
                        barSize={activePeriod.label === "1D" ? 6 : activePeriod.label === "5D" ? 4 : 2}
                        shape={(props: any) => {
                          const { x, y, width, height, payload, yAxis } = props;
                          const isUp = payload.c >= payload.o;
                          const color = isUp ? "oklch(0.70 0.20 150)" : "oklch(0.60 0.22 25)";
                          
                          let highY, lowY, openY, closeY;
                          if (yAxis && yAxis.scale) {
                            highY = yAxis.scale(payload.h);
                            lowY = yAxis.scale(payload.l);
                            openY = yAxis.scale(payload.o);
                            closeY = yAxis.scale(payload.c);
                          } else {
                            const range = Math.max(yDomain[1] - yDomain[0], 0.001);
                            const scalePrice = (p: number) => y + height - ((p - yDomain[0]) / range) * height;
                            highY = scalePrice(payload.h);
                            lowY = scalePrice(payload.l);
                            openY = scalePrice(payload.o);
                            closeY = scalePrice(payload.c);
                          }
                          
                          const bodyTop = Math.min(openY, closeY);
                          const bodyBottom = Math.max(openY, closeY);
                          const bodyHeight = Math.max(Math.abs(openY - closeY), 1);
                          const centerX = x + width / 2;

                          return (
                            <g key={`candle-${props.index}`}>
                              <line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={color} strokeWidth={1} />
                              {/* Body: Filled Green and Red */}
                              <rect 
                                x={x + 1} 
                                y={bodyTop} 
                                width={width - 2} 
                                height={bodyHeight} 
                                fill={color} 
                                stroke={color}
                                strokeWidth={1}
                              />
                            </g>
                          );
                        }}
                      >
                        {chartData.map((_, index) => <Cell key={`body-${index}`} />)}
                      </Bar>
                    )}
                    
                    {indicators.includes("BB") && (
                      <>
                        <Line type="monotone" dataKey="bbUpper" stroke="oklch(0.66 0.22 22)" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                        <Line type="monotone" dataKey="bbLower" stroke="oklch(0.78 0.18 152)" strokeWidth={1} dot={false} strokeDasharray="3 3" />
                      </>
                    )}
                    {indicators.includes("SMA") && <Line type="monotone" dataKey="sma20" stroke="oklch(0.78 0.18 152)" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />}
                    {indicators.includes("EMA") && <Line type="monotone" dataKey="ema12" stroke="oklch(0.74 0.18 52)" strokeWidth={1.5} dot={false} />}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Volume Chart */}
            {indicators.includes("Volume") && (
              <div className="h-[60px] mt-2">
                <ResponsiveContainer>
                  <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <YAxis hide />
                    <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.c >= d.o ? "oklch(0.78 0.18 152 / 0.5)" : "oklch(0.66 0.22 22 / 0.5)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* RSI Indicator */}
            {indicators.includes("RSI") && (
              <div className="h-[80px] mt-2">
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={40} />
                    <ReferenceLine y={70} stroke="oklch(0.66 0.22 22)" strokeDasharray="3 3" />
                    <ReferenceLine y={30} stroke="oklch(0.78 0.18 152)" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="rsi" stroke="oklch(0.74 0.18 285)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Technical Analysis */}
          <div className="rounded-2xl glass p-4">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" /> Technical Analysis
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "RSI (14)", value: chartData[chartData.length - 1]?.rsi?.toFixed(1) || "—", signal: (chartData[chartData.length - 1]?.rsi || 50) > 70 ? "Overbought" : (chartData[chartData.length - 1]?.rsi || 50) < 30 ? "Oversold" : "Neutral" },
                { label: "SMA (20)", value: `$${chartData[chartData.length - 1]?.sma20?.toFixed(2) || "—"}`, signal: quote?.last > (chartData[chartData.length - 1]?.sma20 || 0) ? "Bullish" : "Bearish" },
                { label: "EMA (12)", value: `$${chartData[chartData.length - 1]?.ema12?.toFixed(2) || "—"}`, signal: quote?.last > (chartData[chartData.length - 1]?.ema12 || 0) ? "Bullish" : "Bearish" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg hairline bg-surface-1 p-2">
                  <div className="text-[10px] text-muted-foreground">{item.label}</div>
                  <div className="font-semibold num text-xs mt-0.5">{item.value}</div>
                  <div className={`text-[10px] mt-0.5 ${item.signal.includes("Bull") || item.signal === "Oversold" ? "text-bull" : item.signal.includes("Bear") || item.signal === "Overbought" ? "text-bear" : "text-muted-foreground"}`}>
                    {item.signal}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Advanced Indicators */}
            <div className="mt-3">
              <AdvancedIndicators data={chartData} indicators={indicators} />
            </div>
          </div>
        </div>

        {/* Trading Panel */}
        <div className="space-y-3">
          {/* Quote Stats */}
          <div className="rounded-2xl glass p-4">
            <h3 className="text-xs font-semibold mb-2">Market Data</h3>
            <div className="space-y-1.5 text-xs">
              {[
                { label: "Open", value: `$${quote?.open?.toFixed(2) || "—"}` },
                { label: "High", value: `$${quote?.high?.toFixed(2) || "—"}`, color: "text-bull" },
                { label: "Low", value: `$${quote?.low?.toFixed(2) || "—"}`, color: "text-bear" },
                { label: "Volume", value: quote?.volume?.toLocaleString() || "—" },
                { label: "Prev Close", value: `$${quote?.prevClose?.toFixed(2) || "—"}` },
                { label: "Bid", value: `$${quote?.bid?.toFixed(2) || "—"}` },
                { label: "Ask", value: `$${quote?.ask?.toFixed(2) || "—"}` },
              ].map((stat) => (
                <div key={stat.label} className="flex justify-between">
                  <span className="text-muted-foreground">{stat.label}</span>
                  <span className={`font-semibold num ${(stat as any).color || ""}`}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Order Entry */}
          <div className="rounded-2xl glass p-4">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Place Order
            </h3>
            
            {/* Buy/Sell Toggle */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={() => setOrderSide("buy")}
                className={`h-8 rounded-lg text-xs font-semibold transition ${orderSide === "buy" ? "bg-bull text-white" : "bg-surface-2 text-muted-foreground"}`}
              >
                BUY
              </button>
              <button
                onClick={() => setOrderSide("sell")}
                className={`h-8 rounded-lg text-xs font-semibold transition ${orderSide === "sell" ? "bg-bear text-white" : "bg-surface-2 text-muted-foreground"}`}
              >
                SELL
              </button>
            </div>

            {/* Order Type */}
            <div className="mb-2">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Order Type</label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as any)}
                className="w-full h-8 rounded-lg bg-surface-2 px-2 text-xs"
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop">Stop</option>
              </select>
            </div>

            {/* Quantity */}
            <div className="mb-2">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full h-8 rounded-lg bg-surface-2 px-2 text-xs"
                placeholder="100"
              />
            </div>

            {/* Limit Price */}
            {orderType === "limit" && (
              <div className="mb-2">
                <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Limit Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  className="w-full h-8 rounded-lg bg-surface-2 px-2 text-xs"
                  placeholder="0.00"
                />
              </div>
            )}

            {/* Stop Price */}
            {orderType === "stop" && (
              <div className="mb-2">
                <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Stop Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                  className="w-full h-8 rounded-lg bg-surface-2 px-2 text-xs"
                  placeholder="0.00"
                />
              </div>
            )}

            {/* Order Summary */}
            <div className="rounded-lg bg-surface-2 p-2 mb-2 text-[10px] space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Total</span>
                <span className="font-semibold num">
                  ${((orderType === "limit" ? parseFloat(limitPrice) : quote?.last || 0) * parseInt(quantity || "0")).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Place Order Button */}
            <button
              onClick={placeOrder}
              disabled={orderPending || !conid}
              className={`w-full h-9 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${orderSide === "buy" ? "bg-bull hover:bg-bull/90" : "bg-bear hover:bg-bear/90"} text-white`}
            >
              {orderPending ? (
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              ) : (
                <>{orderSide === "buy" ? "BUY" : "SELL"} {symbol}</>
              )}
            </button>

            <div className="mt-2 text-[10px] text-muted-foreground flex items-start gap-1.5 leading-tight">
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>Orders are sent live to your IBKR account. Trading involves risk.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
