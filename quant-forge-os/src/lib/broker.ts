// Which broker this browser is trading through.
//
// One build now serves two brokers. The choice is made on the sign-in screen,
// kept per browser, and read synchronously by the broker facade on every call,
// so a switch takes effect without a reload and without a rebuild.
//
// It is deliberately NOT stored in Supabase: it says which desk this person is
// sitting at right now, not something about their account. The same login may
// want IBKR on the desktop and E*TRADE on a laptop.

export type BrokerId = "ibkr" | "etrade";

export interface BrokerInfo {
  id: BrokerId;
  /** Full name, for the sign-in card. */
  name: string;
  /** Short badge text, for the header pill. */
  short: string;
  /** One line a trader would recognise. */
  blurb: string;
  /** How a session is kept: shapes what the Broker page tells them to do. */
  session: string;
}

export const BROKERS: readonly BrokerInfo[] = [
  {
    id: "ibkr",
    name: "Interactive Brokers",
    short: "IBKR",
    blurb: "US stocks, options and F&O through the Client Portal Gateway.",
    session: "Sign in at the gateway once a day with your phone's two-factor.",
  },
  {
    id: "etrade",
    name: "E*TRADE",
    short: "E*TRADE",
    blurb: "US stocks and options over E*TRADE's OAuth API.",
    session: "Authorise once a day — the token expires at midnight ET.",
  },
] as const;

const KEY = "nova_broker";
const EVENT = "nova:broker";
const DEFAULT: BrokerId = "ibkr";

const isBroker = (v: unknown): v is BrokerId => v === "ibkr" || v === "etrade";

/** The broker in force right now. Safe on the server and in private mode. */
export function activeBroker(): BrokerId {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const v = localStorage.getItem(KEY);
    return isBroker(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * Switch desks. Fires an event so every open tab's header, broker page and
 * polling queries follow along in the same beat.
 */
export function setActiveBroker(id: BrokerId) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode — the choice simply does not survive the tab */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

export function brokerInfo(id: BrokerId = activeBroker()): BrokerInfo {
  return BROKERS.find((b) => b.id === id) ?? BROKERS[0];
}

/** Subscribe to the choice; returns an unsubscribe. */
export function onBrokerChange(fn: (id: BrokerId) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = () => fn(activeBroker());
  // `storage` only fires in OTHER tabs, so the custom event carries this one.
  window.addEventListener(EVENT, local);
  window.addEventListener("storage", local);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener("storage", local);
  };
}
