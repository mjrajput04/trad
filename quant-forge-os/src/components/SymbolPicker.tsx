import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchSymbols } from "@/lib/api/ibkr";
import { SYMBOL_UNIVERSE } from "@/lib/symbols";
import { Loader2 } from "lucide-react";

function useDebounced<T>(value: T, delay: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

/**
 * Symbol input with a live dropdown of matching IBKR-tradable stocks. Type a
 * ticker or a company name (e.g. "alphabet" → GOOGL); only symbols IBKR can
 * actually trade are suggested.
 */
export function SymbolPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (s: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const q = value.trim();
  const local =
    q.length > 0
      ? SYMBOL_UNIVERSE.filter(
          (s) =>
            s.symbol.toLowerCase().includes(q.toLowerCase()) ||
            s.name.toLowerCase().includes(q.toLowerCase()),
        ).slice(0, 8)
      : [];
  const dq = useDebounced(q, 350);
  const { data: remote = [], isFetching } = useQuery({
    queryKey: ["order-symbol-search", dq],
    queryFn: () => searchSymbols(dq),
    enabled: open && dq.length >= 1,
    staleTime: 60_000,
  });
  const seen = new Set(local.map((s) => s.symbol));
  const results = [
    ...local.map((s) => ({ symbol: s.symbol, name: s.name, tag: s.sector })),
    ...remote
      .filter((r) => !seen.has(r.symbol))
      .slice(0, 8)
      .map((r) => ({ symbol: r.symbol, name: r.name, tag: r.exchange || "IBKR" })),
  ].slice(0, 12);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (s: string) => {
    onChange(s.toUpperCase());
    setOpen(false);
    setIdx(0);
  };

  return (
    <div className="relative" ref={ref}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
          setIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIdx((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (results[idx]) {
              e.preventDefault();
              pick(results[idx].symbol);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Type a symbol or company…"
        autoComplete="off"
        className={className}
      />
      {open && q.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-1 rounded-lg hairline shadow-2xl z-50 overflow-hidden">
          {results.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
              {isFetching ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching IBKR…
                </>
              ) : (
                "No matching stock in IBKR"
              )}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {results.map((r, i) => (
                <button
                  key={r.symbol}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(r.symbol);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-2 ${i === idx ? "bg-surface-2" : ""}`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="font-semibold text-sm">{r.symbol}</span>
                    <span className="text-xs text-muted-foreground truncate">{r.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-surface-2 shrink-0">{r.tag}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
