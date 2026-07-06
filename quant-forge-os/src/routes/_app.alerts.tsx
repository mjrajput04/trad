import { createFileRoute } from "@tanstack/react-router";
import { Bell, Mail, Send, Smartphone, Globe } from "lucide-react";
import { SYMBOL_UNIVERSE } from "@/lib/symbols";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "Alerts · NOVA" }, { name: "description", content: "AI alert center with multi-channel delivery." }] }),
  component: Alerts,
});

const ALERTS = [
  { kind: "Breakout", sym: "NVDA", msg: "Broke ATH on 3.2x avg volume", time: "1m", color: "text-bull" },
  { kind: "News", sym: "META", msg: "Oracle infra deal — bullish sentiment 88%", time: "4m", color: "text-info" },
  { kind: "Volatility", sym: "TSLA", msg: "IV30 spiked +28% in last hour", time: "9m", color: "text-warn" },
  { kind: "Stop", sym: "AMD", msg: "Stop loss triggered at $128.40", time: "22m", color: "text-bear" },
  { kind: "Portfolio", sym: "—", msg: "Tech allocation crossed 60% threshold", time: "1h", color: "text-violet" },
];

function Alerts() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Alert Center <span className="align-middle ml-2 rounded bg-warn/15 text-warn text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wider">Preview</span></h1>
        <p className="text-sm text-muted-foreground">Alert engine is not connected yet — the feed below shows sample data.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl glass p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4 text-info" /> Sample Feed</div>
            <span className="text-[11px] text-muted-foreground">demo data</span>
          </div>
          <div className="space-y-2">
            {ALERTS.map((a, i) => (
              <div key={i} className="rounded-xl hairline bg-surface-1 p-3 flex items-start gap-3 hover:bg-surface-2 transition">
                <div className={`h-8 w-8 rounded-md bg-surface-2 grid place-items-center text-[10px] font-bold uppercase ${a.color}`}>
                  {a.kind.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${a.color}`}>{a.kind}</span>
                    {a.sym !== "—" && <span className="text-xs font-semibold">{a.sym}</span>}
                    <span className="text-[10px] text-muted-foreground ml-auto">{a.time} ago</span>
                  </div>
                  <div className="text-sm mt-0.5">{a.msg}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl glass p-5">
            <div className="text-sm font-semibold mb-3">Delivery Channels</div>
            {[
              { icon: Bell, label: "In-app", on: true },
              { icon: Mail, label: "Email", on: true },
              { icon: Send, label: "Telegram", on: false },
              { icon: Smartphone, label: "Mobile Push", on: true },
              { icon: Globe, label: "Browser", on: false },
            ].map((c) => (
              <div key={c.label} className="flex items-center justify-between py-2 hairline-b last:border-0">
                <div className="flex items-center gap-2 text-sm"><c.icon className="h-4 w-4 text-muted-foreground" /> {c.label}</div>
                <div className={`relative h-5 w-9 rounded-full ${c.on ? "bg-primary glow-primary" : "bg-surface-2"} transition`}>
                  <span className={`absolute top-0.5 ${c.on ? "right-0.5" : "left-0.5"} h-4 w-4 rounded-full bg-background transition`} />
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl glass p-5">
            <div className="text-sm font-semibold mb-3">New Alert</div>
            <div className="space-y-2">
              <select className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm focus:outline-none">
                {SYMBOL_UNIVERSE.slice(0, 12).map((q) => <option key={q.symbol}>{q.symbol}</option>)}
              </select>
              <select className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm">
                <option>Price crosses above</option>
                <option>Price crosses below</option>
                <option>% change exceeds</option>
                <option>Volume spike</option>
              </select>
              <input className="w-full h-9 rounded-lg bg-surface-1 hairline px-3 text-sm num" placeholder="Target value" />
              <button disabled title="Alert engine coming soon" className="w-full h-9 rounded-lg gradient-primary text-background text-xs font-semibold opacity-50 cursor-not-allowed">Create Alert (coming soon)</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
