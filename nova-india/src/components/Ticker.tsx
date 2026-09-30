import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getQuotes } from "@/lib/api/ibkr";
import { UNIVERSE_SYMBOLS } from "@/lib/symbols";
import { fmtMoney } from "@/lib/market-data";

export function Ticker() {
  const navigate = useNavigate();

  const { data: quotes = [] } = useQuery({
    queryKey: ["ticker-quotes"],
    queryFn: () => getQuotes(UNIVERSE_SYMBOLS),
    refetchInterval: 3_000,
    staleTime: 1_500,
  });

  const tickerData = quotes
    .filter((q) => q.last > 0)
    .map((q) => ({ symbol: q.symbol, price: q.last, changePct: q.changePct }));

  const items = [...tickerData, ...tickerData]; // Duplicate for seamless scrolling
  return (
    <div className="relative overflow-hidden hairline-b bg-[var(--topbar-bg)] backdrop-blur-md">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent z-10" />
      <div className="ticker-track flex gap-8 whitespace-nowrap py-2.5">
        {items.map((q, i) => {
          const up = q.changePct >= 0;
          return (
            <div
              key={`${q.symbol}-${i}`}
              onClick={() => navigate({ to: `/stock/${q.symbol}` })}
              className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-2 rounded px-2 py-1 transition"
            >
              <span className="font-semibold tracking-wide">{q.symbol}</span>
              <span className="num text-muted-foreground">{fmtMoney(q.price)}</span>
              <span className={`num ${up ? "text-bull" : "text-bear"}`}>
                {up ? "+" : ""}
                {q.changePct.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
