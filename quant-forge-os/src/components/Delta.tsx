import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function Delta({ value, suffix = "%", className }: { value: number; suffix?: string; className?: string }) {
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium num",
        positive ? "text-bull bg-bull/10" : "text-bear bg-bear/10",
        className,
      )}
    >
      {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {positive ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

export function LiveDot({ color = "var(--bull)" }: { color?: string }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inset-0 rounded-full pulse-dot" style={{ background: color }} />
      <span className="absolute inset-0 rounded-full opacity-50 blur-[3px]" style={{ background: color }} />
    </span>
  );
}
