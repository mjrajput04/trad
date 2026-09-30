import { fmtMoney } from "@/lib/market-data";

const money = (n?: number) => `$${fmtMoney(Number(n) || 0)}`;

export function Level({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone: "info" | "bull" | "bear" }) {
  const color = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-info";
  return (
    <div className="flex-1 rounded-lg hairline bg-surface-1 px-2.5 py-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold num ${color}`}>{money(value)}</div>
      {sub && <div className={`text-[10px] num ${color}`}>{sub}</div>}
    </div>
  );
}

// Live position of the current price between Stop (left/red) and Target
// (right/green), with Entry marked. The dot animates as the price ticks, so you
// can see at a glance whether it's heading to target (profit) or stop (loss).
export function LevelBar({ entry, target, stop, now }: { entry: number; target: number; stop: number; now?: number }) {
  const lo = Math.min(stop, target);
  const hi = Math.max(stop, target);
  const span = hi - lo || 1;
  const clamp = (p: number) => Math.max(0, Math.min(100, p));
  const pos = (v: number) => clamp(((v - lo) / span) * 100);
  const entryPos = pos(entry);
  const nowPos = now != null ? pos(now) : null;
  const inProfit = now != null && now >= entry;
  const toTarget = target !== entry ? (((now ?? entry) - entry) / (target - entry)) * 100 : 0;
  const toStop = entry !== stop ? ((entry - (now ?? entry)) / (entry - stop)) * 100 : 0;
  return (
    <div>
      <div className="relative h-2 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-bear/30" style={{ width: `${entryPos}%` }} />
        <div className="absolute inset-y-0 rounded-r-full bg-bull/30" style={{ left: `${entryPos}%`, right: 0 }} />
        <div className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-info" style={{ left: `${entryPos}%` }} />
        {nowPos != null && (
          <div
            className={`absolute top-1/2 h-3.5 w-3.5 rounded-full border-2 border-background shadow ${inProfit ? "bg-bull" : "bg-bear"} transition-all duration-700`}
            style={{ left: `${nowPos}%`, transform: "translate(-50%, -50%)" }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[9px] mt-1">
        <span className="text-bear">Stop</span>
        {now != null && (
          <span className={`font-semibold ${inProfit ? "text-bull" : "text-bear"}`}>
            {inProfit
              ? `▲ ${clamp(toTarget).toFixed(0)}% to target`
              : `▼ ${clamp(toStop).toFixed(0)}% to stop`}
          </span>
        )}
        <span className="text-bull">Target</span>
      </div>
    </div>
  );
}
