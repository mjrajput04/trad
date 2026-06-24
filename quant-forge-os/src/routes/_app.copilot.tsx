import { createFileRoute } from "@tanstack/react-router";
import { Brain, Send, Sparkles, TrendingUp } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_app/copilot")({
  head: () => ({ meta: [{ title: "AI Copilot · NOVA" }, { name: "description", content: "Built-in AI trading copilot — analysis, ideas, and risk." }] }),
  component: Copilot,
});

type Msg = { role: "user" | "ai"; text: string; idea?: any };

const SUGGESTIONS = [
  "Analyze NVDA setup for tomorrow",
  "Scan for breakouts in semis",
  "Hedge my portfolio against tech drawdown",
  "Earnings risk in next 5 sessions?",
];

function Copilot() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "ai",
      text: "I see NVDA broke its 52-week high on 3.2x average volume with bullish RSI divergence on the 1H. Sentiment is strongly bullish (88%) following the Rubin announcement. Here's a trade plan you can act on.",
      idea: {
        sym: "NVDA", side: "LONG", entry: 144.20, stop: 138.40, tp: 158.60, conf: 84,
      },
    },
  ]);
  const [input, setInput] = useState("");

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }, {
      role: "ai",
      text: `Working on it… I'll cross-reference indicators, sentiment, and your portfolio exposure to "${text}".`,
    }]);
    setInput("");
  };

  return (
    <div className="p-6 grid lg:grid-cols-[1fr_320px] gap-4 h-[calc(100vh-7rem)]">
      <div className="rounded-2xl glass flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 h-14 hairline-b">
          <div className="h-8 w-8 rounded-md gradient-primary grid place-items-center glow-primary">
            <Sparkles className="h-4 w-4 text-background" />
          </div>
          <div>
            <div className="text-sm font-semibold">NOVA Copilot</div>
            <div className="text-[11px] text-muted-foreground">Multimodal trading assistant · GPT-class</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "ai" && (
                <div className="h-8 w-8 rounded-full gradient-primary grid place-items-center shrink-0">
                  <Brain className="h-4 w-4 text-background" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl p-4 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "glass"}`}>
                <p className="leading-relaxed">{m.text}</p>
                {m.idea && (
                  <div className="mt-3 rounded-xl hairline bg-surface-1 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-bull" />
                        <span className="text-sm font-semibold">{m.idea.sym}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-bull/15 text-bull">
                          {m.idea.side}
                        </span>
                      </div>
                      <span className="text-[10px] num text-muted-foreground">Conf {m.idea.conf}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <Field label="Entry" value={`$${m.idea.entry}`} />
                      <Field label="Stop" value={`$${m.idea.stop}`} color="text-bear" />
                      <Field label="Target" value={`$${m.idea.tp}`} color="text-bull" />
                    </div>
                    <button className="mt-3 w-full h-8 rounded-md gradient-primary text-background text-xs font-semibold">
                      Open in Order Ticket
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 hairline-t">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="text-[11px] rounded-full hairline bg-surface-1 hover:bg-surface-2 px-3 py-1.5 transition">
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Ask anything about markets, your portfolio, or a chart…"
              className="flex-1 h-10 rounded-lg bg-surface-1 hairline px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button onClick={() => send(input)} className="h-10 w-10 rounded-lg gradient-primary grid place-items-center glow-primary">
              <Send className="h-4 w-4 text-background" />
            </button>
          </div>
        </div>
      </div>

      <aside className="space-y-4 overflow-y-auto scrollbar-thin">
        <div className="rounded-2xl glass p-4">
          <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Active Context</div>
          <ul className="text-xs space-y-1.5">
            <li className="flex justify-between"><span className="text-muted-foreground">Portfolio</span><span className="num">$124,582</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Open positions</span><span className="num">14</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Watchlist</span><span className="num">25 syms</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Risk regime</span><span className="text-warn">Elevated</span></li>
          </ul>
        </div>
        <div className="rounded-2xl glass p-4">
          <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Recent Ideas</div>
          <div className="space-y-2 text-xs">
            {["NVDA Long · 84%", "AMD Long · 71%", "TSLA Hedge · 62%"].map((t) => (
              <div key={t} className="rounded-md hairline bg-surface-1 p-2.5">{t}</div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, color = "" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold num ${color}`}>{value}</div>
    </div>
  );
}
