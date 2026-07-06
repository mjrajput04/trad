import { useState } from "react";
import { Pencil, TrendingUp, Minus, Circle, Square, Type, Trash2, MousePointer2, MoveRight, Scissors, GripVertical } from "lucide-react";

export type DrawingTool = "none" | "vertical" | "trendline" | "horizontal" | "rectangle" | "circle" | "fib";

export interface Drawing {
  id: string;
  type: DrawingTool;
  points: { t: number; p: number }[]; // Time and Price
  color: string;
  text?: string;
}

export function ChartDrawingTools({ 
  activeTool, 
  setActiveTool,
  drawings,
  setDrawings 
}: {
  activeTool: DrawingTool;
  setActiveTool: (tool: DrawingTool) => void;
  drawings: Drawing[];
  setDrawings: (drawings: Drawing[]) => void;
}) {
  const tools = [
    { id: "none" as DrawingTool, icon: MousePointer2, label: "Cursor" },
    { id: "vertical" as DrawingTool, icon: GripVertical, label: "Vertical Line" },
    { id: "trendline" as DrawingTool, icon: TrendingUp, label: "Trend Line" },
    { id: "horizontal" as DrawingTool, icon: Minus, label: "Horizontal Line" },
    { id: "rectangle" as DrawingTool, icon: Square, label: "Rectangle" },
    { id: "circle" as DrawingTool, icon: Circle, label: "Circle" },
  ];

  return (
    <div className="flex items-center gap-1 bg-surface-1/50 p-1 rounded-xl hairline">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setActiveTool(tool.id)}
          className={`p-1.5 rounded-lg transition ${
            activeTool === tool.id 
              ? "bg-primary text-white shadow-lg" 
              : "hover:bg-surface-2 text-muted-foreground"
          }`}
          title={tool.label}
        >
          <tool.icon className="h-3.5 w-3.5" />
        </button>
      ))}
      <div className="w-px h-4 bg-surface-3 mx-1" />
      <button
        onClick={() => setDrawings([])}
        disabled={drawings.length === 0}
        className={`p-1.5 rounded-lg transition ${
          drawings.length === 0 
            ? "opacity-30 cursor-not-allowed" 
            : "hover:bg-bear/20 hover:text-bear text-muted-foreground"
        }`}
        title="Clear All"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AdvancedIndicators({ 
  data, 
  indicators 
}: { 
  data: any[]; 
  indicators: string[] 
}) {
  if (!data.length) return null;

  const last = data[data.length - 1];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      {indicators.includes("MACD") && (
        <IndicatorCard
          label="MACD"
          value={last.macd?.toFixed(2) || "—"}
          signal={last.macd > 0 ? "Bullish" : "Bearish"}
          color={last.macd > 0 ? "text-bull" : "text-bear"}
        />
      )}
      {indicators.includes("BB") && (
        <IndicatorCard
          label="Bollinger Bands"
          value={`${last.bbUpper?.toFixed(2) || "—"} / ${last.bbLower?.toFixed(2) || "—"}`}
          signal={last.c > last.bbUpper ? "Overbought" : last.c < last.bbLower ? "Oversold" : "Normal"}
          color={last.c > last.bbUpper ? "text-bear" : last.c < last.bbLower ? "text-bull" : "text-muted-foreground"}
        />
      )}
      {indicators.includes("ATR") && (
        <IndicatorCard
          label="ATR (14)"
          value={last.atr?.toFixed(2) || "—"}
          signal="Volatility"
          color="text-violet"
        />
      )}
      {indicators.includes("OBV") && (
        <IndicatorCard
          label="OBV"
          value={formatLargeNumber(last.obv || 0)}
          signal="Volume Trend"
          color="text-info"
        />
      )}
    </div>
  );
}

function IndicatorCard({ 
  label, 
  value, 
  signal, 
  color 
}: { 
  label: string; 
  value: string; 
  signal: string; 
  color: string; 
}) {
  return (
    <div className="rounded-lg hairline bg-surface-1 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold num mt-1 ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{signal}</div>
    </div>
  );
}

function formatLargeNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(0);
}

// Calculate additional indicators
export function enhanceDataWithIndicators(data: any[]): any[] {
  return data.map((bar, i) => {
    const enhanced = { ...bar };

    // SMA 20
    if (i >= 19) {
      enhanced.sma20 = calculateSMA(data, i, 20);
    }

    // EMA 12
    if (i >= 11) {
      enhanced.ema12 = calculateEMA(data, i, 12);
    }

    // RSI 14
    if (i >= 14) {
      enhanced.rsi = calculateRSI(data, i, 14);
    }

    // MACD
    if (i >= 26) {
      const ema12 = calculateEMA(data, i, 12);
      const ema26 = calculateEMA(data, i, 26);
      enhanced.macd = ema12 - ema26;
    }

    // Bollinger Bands
    if (i >= 20) {
      const sma20 = calculateSMA(data, i, 20);
      const stdDev = calculateStdDev(data, i, 20);
      enhanced.bbUpper = sma20 + 2 * stdDev;
      enhanced.bbLower = sma20 - 2 * stdDev;
    }

    // ATR (Average True Range)
    if (i >= 14) {
      enhanced.atr = calculateATR(data, i, 14);
    }

    // OBV (On Balance Volume)
    if (i > 0) {
      const prevOBV = data[i - 1].obv || 0;
      enhanced.obv = bar.c > data[i - 1].c 
        ? prevOBV + bar.v 
        : bar.c < data[i - 1].c 
        ? prevOBV - bar.v 
        : prevOBV;
    } else {
      enhanced.obv = bar.v;
    }

    return enhanced;
  });
}

function calculateSMA(data: any[], idx: number, period: number): number {
  if (idx < period - 1) return 0;
  const slice = data.slice(idx - period + 1, idx + 1);
  return slice.reduce((sum, d) => sum + d.c, 0) / period;
}

function calculateEMA(data: any[], idx: number, period: number): number {
  if (idx < period - 1) return 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, d) => sum + d.c, 0) / period;
  for (let i = period; i <= idx; i++) {
    ema = data[i].c * k + ema * (1 - k);
  }
  return ema;
}

function calculateStdDev(data: any[], idx: number, period: number): number {
  if (idx < period - 1) return 0;
  const slice = data.slice(idx - period + 1, idx + 1);
  const mean = slice.reduce((sum, d) => sum + d.c, 0) / period;
  const variance = slice.reduce((sum, d) => sum + Math.pow(d.c - mean, 2), 0) / period;
  return Math.sqrt(variance);
}

function calculateATR(data: any[], idx: number, period: number): number {
  if (idx < period) return 0;
  let atr = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const tr = Math.max(
      data[i].h - data[i].l,
      Math.abs(data[i].h - (data[i - 1]?.c || data[i].c)),
      Math.abs(data[i].l - (data[i - 1]?.c || data[i].c))
    );
    atr += tr;
  }
  return atr / period;
}

function calculateRSI(data: any[], idx: number, period: number): number {
  if (idx < period) return 50;
  let gains = 0, losses = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const change = data[i].c - (data[i - 1]?.c || data[i].c);
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
