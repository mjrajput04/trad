// Switch desks without signing out.
//
// The first version asked at sign-in, which put the question in the wrong
// place: it is not part of proving who you are, and answering it meant a
// logout to change your mind. It belongs in the header, next to the session
// pill that tells you whether that broker is actually connected.
//
// Nothing else has to happen on a switch. Every cache entry holding broker
// data is keyed by the active broker, so the new key simply has no data yet
// and each view refetches against the broker now in force.

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Building2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BROKERS, activeBroker, setActiveBroker, onBrokerChange, type BrokerId } from "@/lib/broker";
import { toast } from "sonner";

export function BrokerSwitch({ compact = false }: { compact?: boolean }) {
  const [broker, setBroker] = useState<BrokerId>(() => activeBroker());
  const navigate = useNavigate();

  // Follow a switch made in another tab, or from the Broker page.
  useEffect(() => onBrokerChange(setBroker), []);

  const current = BROKERS.find((b) => b.id === broker) ?? BROKERS[0];

  const choose = (id: BrokerId) => {
    if (id === broker) return;
    setActiveBroker(id);
    const picked = BROKERS.find((b) => b.id === id);
    toast.success(`Switched to ${picked?.name}`);
    // Straight to the Broker page: a desk you have just arrived at may not have
    // a live session, and that is the one page that can tell you and fix it.
    navigate({ to: "/broker" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={`Trading through ${current.name} — click to switch`}
          className="inline-flex items-center gap-1.5 h-9 rounded-lg hairline bg-surface-1 hover:bg-surface-2 px-2 md:px-2.5 text-[11px] font-semibold text-foreground transition"
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          {!compact && <span className="hidden sm:inline">{current.short}</span>}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Trade through
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {BROKERS.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onSelect={() => choose(b.id)}
            className="flex items-start gap-2 py-2 cursor-pointer"
          >
            <Check
              className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${b.id === broker ? "text-primary" : "opacity-0"}`}
            />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold">{b.name}</span>
              <span className="block text-[10.5px] text-muted-foreground leading-snug">{b.blurb}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
