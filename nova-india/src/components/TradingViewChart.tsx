import { memo, useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

/**
 * Free TradingView Advanced Chart embed — the real thing: candles, indicators,
 * drawing tools, timeframes, all built in. No API key needed; the widget
 * script turns its JSON config into a hosted iframe.
 */
export const TradingViewChart = memo(function TradingViewChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [theme] = useTheme();

  useEffect(() => {
    const container = ref.current;
    if (!container || !symbol) return;
    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    wrapper.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      interval: "5",
      timezone: "America/New_York",
      theme,
      style: "1",
      locale: "en",
      withdateranges: true,
      allow_symbol_change: false,
      hide_side_toolbar: false,
      details: false,
      calendar: false,
      autosize: true,
      support_host: "https://www.tradingview.com",
    });
    wrapper.appendChild(script);
    container.appendChild(wrapper);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol, theme]);

  return <div ref={ref} className="w-full h-full" />;
});
