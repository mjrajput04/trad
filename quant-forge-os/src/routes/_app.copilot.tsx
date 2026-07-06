import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Brain, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { getAccountSummary, getPositions } from "@/lib/api/ibkr";
import { fmtMoney } from "@/lib/market-data";

export const Route = createFileRoute("/_app/copilot")({
  head: () => ({ meta: [{ title: "AI Copilot · NOVA" }, { name: "description", content: "AI trading copilot (preview)." }] }),
  component: Copilot,
});

type Msg = { role: "user" | "ai"; text: string };

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
      text: "The AI copilot backend is not connected yet — this chat is a preview and does not produce real analysis. Your live account context (right panel) is already pulled from IBKR.",
    },
  ]);
  const [input, setInput] = useState("");

  const { data: summary } = useQuery({
    queryKey: ["ibkr-summary"],
    queryFn: getAccountSummary,
    refetchInterval: 30_000,
  });
  const { data: positions = [] } = useQuery({
    queryKey: ["ibkr-positions"],
    queryFn: getPositions,
    refetchInterval: 30_000,
  });

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }, {
      role: "ai",
      text: "The AI backend is not connected yet, so I can't answer this for real. Connect an LLM backend to enable analysis.",
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
            <div className="text-sm font-semibold">NOVA Copilot <span className="align-middle ml-1 rounded bg-warn/15 text-warn text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider">Preview</span></div>
            <div className="text-[11px] text-muted-foreground">AI backend not connected yet</div>
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
          <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Active Context · Live from IBKR</div>
          <ul className="text-xs space-y-1.5">
            <li className="flex justify-between"><span className="text-muted-foreground">Portfolio</span><span className="num">${fmtMoney(summary?.netLiquidation ?? 0)}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Open positions</span><span className="num">{positions.length}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Unrealized P&L</span><span className={`num ${(summary?.unrealizedPnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>${fmtMoney(summary?.unrealizedPnl ?? 0)}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Buying power</span><span className="num">${fmtMoney(summary?.buyingPower ?? 0)}</span></li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

