import { createFileRoute } from "@tanstack/react-router";
import { Brain, Trophy } from "lucide-react";
import { Cell, Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_app/journal")({
  head: () => ({ meta: [{ title: "Journal · NOVA" }, { name: "description", content: "AI trading journal with setup analytics." }] }),
  component: Journal,
});

const monthly = Array.from({ length: 22 }, (_, i) => ({ d: i + 1, pnl: (Math.random() - 0.4) * 1800 }));

const TRADES = [
  { sym: "NVDA", side: "LONG", setup: "Breakout", r: 2.4, pnl: 1240, win: true },
  { sym: "TSLA", side: "SHORT", setup: "Reversal", r: -1.0, pnl: -480, win: false },
  { sym: "AAPL", side: "LONG", setup: "Pullback", r: 1.8, pnl: 920, win: true },
  { sym: "AMD", side: "LONG", setup: "Momentum", r: 3.1, pnl: 1860, win: true },
  { sym: "META", side: "LONG", setup: "Gap & Go", r: -1.0, pnl: -310, win: false },
  { sym: "JPM", side: "LONG", setup: "Breakout", r: 1.2, pnl: 540, win: true },
];

function Journal() {
  const wins = TRADES.filter((t) => t.win).length;
  const winRate = Math.round((wins / TRADES.length) * 100);
  const totalPnl = TRADES.reduce((a, t) => a + t.pnl, 0);
  const avgR = (TRADES.reduce((a, t) => a + t.r, 0) / TRADES.length).toFixed(2);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Trade Journal</h1>
        <p className="text-sm text-muted-foreground">AI-assisted journaling with setup analytics and pattern detection.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini label="Win Rate" value={`${winRate}%`} color="text-bull" />
        <Mini label="Total P&L" value={`+$${totalPnl.toLocaleString()}`} color="text-bull" />
        <Mini label="Avg R" value={avgR} color="text-info" />
        <Mini label="Best Setup" value="Breakout" color="text-violet" icon={Trophy} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl glass p-5">
          <div className="text-sm font-semibold mb-3">Daily P&L · Last 22 Sessions</div>
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={monthly}>
                <XAxis dataKey="d" tick={{ fontSize: 10, fill: "oklch(0.66 0.018 255)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "oklch(0.66 0.018 255)" }} axisLine={false} tickLine={false} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {monthly.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? "oklch(0.78 0.18 152)" : "oklch(0.66 0.22 22)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl glass p-5 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-violet" />
            <div className="text-sm font-semibold">AI Insights</div>
          </div>
          <ul className="space-y-3 text-xs">
            <li className="rounded-lg hairline bg-surface-1 p-3">
              <div className="text-bull font-semibold">Edge detected</div>
              <div className="text-muted-foreground mt-1">Breakout setups deliver 1.9R avg vs 0.6R for reversals. Lean into momentum plays.</div>
            </li>
            <li className="rounded-lg hairline bg-surface-1 p-3">
              <div className="text-bear font-semibold">Repeated mistake</div>
              <div className="text-muted-foreground mt-1">3 of last 5 losses entered in first 15min — volatility too high. Wait for 9:45 ET.</div>
            </li>
            <li className="rounded-lg hairline bg-surface-1 p-3">
              <div className="text-warn font-semibold">Pattern</div>
              <div className="text-muted-foreground mt-1">Win rate drops 18% on Fridays. Consider reducing size.</div>
            </li>
          </ul>
        </div>
      </div>

      <div className="rounded-2xl glass overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground hairline-b">
          <div className="col-span-2">Symbol</div>
          <div className="col-span-2">Side</div>
          <div className="col-span-3">Setup</div>
          <div className="col-span-2 text-right">R Multiple</div>
          <div className="col-span-2 text-right">P&L</div>
          <div className="col-span-1 text-right">Result</div>
        </div>
        {TRADES.map((t, i) => (
          <div key={i} className="grid grid-cols-12 items-center px-4 py-3 hairline-b last:border-0 hover:bg-surface-2 transition">
            <div className="col-span-2 text-sm font-semibold">{t.sym}</div>
            <div className="col-span-2 text-xs">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.side === "LONG" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
                {t.side}
              </span>
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">{t.setup}</div>
            <div className={`col-span-2 text-right num text-sm ${t.r >= 0 ? "text-bull" : "text-bear"}`}>{t.r >= 0 ? "+" : ""}{t.r}R</div>
            <div className={`col-span-2 text-right num text-sm font-semibold ${t.pnl >= 0 ? "text-bull" : "text-bear"}`}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toLocaleString()}</div>
            <div className="col-span-1 text-right">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${t.win ? "text-bull" : "text-bear"}`}>{t.win ? "Win" : "Loss"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon?: any }) {
  return (
    <div className="rounded-xl glass p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={`mt-2 text-xl font-semibold num ${color}`}>{value}</div>
    </div>
  );
}
