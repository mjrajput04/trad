import { createFileRoute } from "@tanstack/react-router";
import { Brain, ExternalLink, TrendingDown, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_app/news")({
  head: () => ({ meta: [{ title: "AI News · NOVA" }, { name: "description", content: "AI-scored news intelligence across markets, filings, and macro." }] }),
  component: News,
});

const NEWS = [
  { src: "Bloomberg", t: "Nvidia unveils next-gen Rubin architecture, beats Wall Street targets", tickers: ["NVDA", "AMD"], bull: 92, bear: 6, impact: 88, time: "2m" },
  { src: "Reuters", t: "Fed minutes: officials see fewer rate cuts in 2026 amid sticky inflation", tickers: ["SPX", "DXY"], bull: 18, bear: 78, impact: 91, time: "8m" },
  { src: "WSJ", t: "Apple's services revenue tops $30B, India share doubles YoY", tickers: ["AAPL"], bull: 84, bear: 8, impact: 72, time: "14m" },
  { src: "CNBC", t: "Tesla cuts FSD price as competition intensifies in China", tickers: ["TSLA"], bull: 24, bear: 64, impact: 68, time: "22m" },
  { src: "FT", t: "Meta inks $10B AI infra deal with Oracle to expand Llama training", tickers: ["META", "ORCL"], bull: 76, bear: 14, impact: 80, time: "31m" },
  { src: "Bloomberg", t: "Oil slips below $68 as OPEC+ signals output increase", tickers: ["XOM", "CVX"], bull: 12, bear: 70, impact: 55, time: "48m" },
];

function News() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">News <span className="align-middle ml-2 rounded bg-warn/15 text-warn text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wider">Preview</span></h1>
        <p className="text-sm text-muted-foreground">Live news feed is not connected yet — the headlines below are sample data.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {NEWS.map((n, i) => {
          const dominant = n.bull >= n.bear ? "bull" : "bear";
          return (
            <article key={i} className="rounded-2xl glass p-5 hover:bg-surface-2 transition cursor-pointer group">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{n.src}</span>
                  <span>·</span>
                  <span>{n.time} ago</span>
                  <div className="flex gap-1 ml-2">
                    {n.tickers.map((t) => (
                      <span key={t} className="rounded bg-surface-2 hairline px-1.5 py-0.5 text-[10px] font-medium">{t}</span>
                    ))}
                  </div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
              </div>
              <h3 className="text-sm font-medium leading-snug">{n.t}</h3>

              <div className="mt-4 grid grid-cols-4 gap-3">
                <Score label="Bull" value={n.bull} color="var(--bull)" icon={TrendingUp} />
                <Score label="Bear" value={n.bear} color="var(--bear)" icon={TrendingDown} />
                <Score label="Impact" value={n.impact} color="var(--info)" />
                <Score label="AI Conf." value={Math.max(n.bull, n.bear)} color="var(--violet)" icon={Brain} />
              </div>

              <div className="mt-3 h-1 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${dominant === "bull" ? n.bull : n.bear}%`,
                    background: dominant === "bull" ? "var(--bull)" : "var(--bear)",
                    boxShadow: `0 0 12px ${dominant === "bull" ? "var(--bull)" : "var(--bear)"}`,
                  }}
                />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Score({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon?: any }) {
  return (
    <div className="rounded-lg hairline bg-surface-1 p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" style={{ color }} />} {label}
      </div>
      <div className="text-sm font-semibold num mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}
