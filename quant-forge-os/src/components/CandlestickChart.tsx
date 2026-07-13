import { useMemo, useRef, useEffect, useState } from "react";

export function CandlestickChart({ 
  data, 
  width, 
  height,
  yDomain
}: { 
  data: any[]; 
  width: number; 
  height: number;
  yDomain?: [number, number];
}) {
  const [hoveredCandle, setHoveredCandle] = useState<{ index: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const candles = useMemo(() => {
    if (!data.length) return [];
    
    // Use provided yDomain or calculate from data
    const yMin = yDomain ? yDomain[0] : Math.min(...data.map(d => d.l));
    const yMax = yDomain ? yDomain[1] : Math.max(...data.map(d => d.h));
    const yRange = yMax - yMin;
    
    // Better spacing calculation
    const barWidth = width / data.length;
    const candleWidth = Math.min(barWidth * 0.7, 8);
    
    return data.map((d, i) => {
      const isUp = d.c >= d.o;
      // Center each candle in its allocated space
      const x = (i + 0.5) * barWidth;
      
      // Invert Y coordinates (SVG origin is top-left)
      const yHigh = height - ((d.h - yMin) / yRange) * height;
      const yLow = height - ((d.l - yMin) / yRange) * height;
      const yOpen = height - ((d.o - yMin) / yRange) * height;
      const yClose = height - ((d.c - yMin) / yRange) * height;
      
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1);
      
      return {
        x,
        yHigh,
        yLow,
        bodyTop,
        bodyHeight,
        candleWidth,
        isUp,
        data: d,
      };
    });
  }, [data, width, height, yDomain]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Find the closest candle
    const barWidth = width / data.length;
    const candleIndex = Math.floor(x / barWidth);
    
    if (candleIndex >= 0 && candleIndex < candles.length) {
      const candle = candles[candleIndex];
      // Check if mouse is within candle bounds
      if (Math.abs(x - candle.x) <= candle.candleWidth / 2 + 5) {
        setHoveredCandle({ index: candleIndex, x: e.clientX, y: e.clientY });
      } else {
        setHoveredCandle(null);
      }
    } else {
      setHoveredCandle(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredCandle(null);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  if (!data.length) return null;
  
  return (
    <>
      <svg 
        ref={svgRef}
        width={width} 
        height={height}
        style={{ 
          position: "absolute", 
          top: 0, 
          left: 0, 
          pointerEvents: "all",
          zIndex: 10
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {candles.map((candle, i) => (
          <g key={i}>
            {/* Wick */}
            <line
              x1={candle.x}
              y1={candle.yHigh}
              x2={candle.x}
              y2={candle.yLow}
              stroke={candle.isUp ? "var(--bull)" : "var(--bear)"}
              strokeWidth={1}
            />
            {/* Body */}
            <rect
              x={candle.x - candle.candleWidth / 2}
              y={candle.bodyTop}
              width={candle.candleWidth}
              height={candle.bodyHeight}
              fill={candle.isUp ? "var(--bull)" : "var(--bear)"}
              stroke={candle.isUp ? "var(--bull)" : "var(--bear)"}
              strokeWidth={0.5}
              rx={0.5}
            />
            {/* Invisible hover area */}
            <rect
              x={candle.x - candle.candleWidth / 2 - 5}
              y={0}
              width={candle.candleWidth + 10}
              height={height}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
            />
          </g>
        ))}
      </svg>
      
      {/* Tooltip */}
      {hoveredCandle && (
        <div
          style={{
            position: 'fixed',
            left: hoveredCandle.x - 250,
            top: hoveredCandle.y - 150,
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '11px',
            color: 'var(--popover-foreground)',
            zIndex: 1000,
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>
            {formatTime(candles[hoveredCandle.index].data.t)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
            <div>Open: <span style={{ color: 'var(--bull)' }}>${candles[hoveredCandle.index].data.o.toFixed(2)}</span></div>
            <div>High: <span style={{ color: 'var(--bull)' }}>${candles[hoveredCandle.index].data.h.toFixed(2)}</span></div>
            <div>Low: <span style={{ color: 'var(--bear)' }}>${candles[hoveredCandle.index].data.l.toFixed(2)}</span></div>
            <div>Close: <span style={{ color: candles[hoveredCandle.index].data.c >= candles[hoveredCandle.index].data.o ? 'var(--bull)' : 'var(--bear)' }}>${candles[hoveredCandle.index].data.c.toFixed(2)}</span></div>
          </div>
        </div>
      )}
    </>
  );
}
