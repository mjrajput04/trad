import React, { createContext, useContext, useState, useEffect } from "react";
import { setIBKRAccount } from "./api/broker";
import {
  activeBroker,
  accountStorageKey,
  accountChangeEvent,
  envAccount as brokerEnvAccount,
  onBrokerChange,
  type BrokerId,
} from "./broker";

interface TradingContextType {
  isPaper: boolean;
  setIsPaper: (value: boolean) => void;
  paperConfigured: boolean;
  liveAccount: string;
  paperAccount: string;
  currentAccount: string;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export function TradingProvider({ children }: { children: React.ReactNode }) {
  // Everything here is per broker. An account number belongs to one of them,
  // so the env pin, the remembered value and the announcement are all keyed by
  // whichever is active — and the whole lot re-reads when the trader switches.
  const [broker, setBroker] = useState<BrokerId>(() => activeBroker());
  useEffect(() => onBrokerChange(setBroker), []);

  // Pinned by env for the owner's build. When unset (a client instance, or
  // E*TRADE, which adopts the first ACTIVE account), it is whatever the broker
  // reports after sign-in; we remember that across reloads in localStorage.
  const envAccount: string = brokerEnvAccount(broker);
  const [detected, setDetected] = useState<string>("");
  useEffect(() => {
    const key = accountStorageKey(broker);
    const evt = accountChangeEvent(broker);
    setDetected("");
    try {
      const saved = localStorage.getItem(key);
      if (saved) setDetected(saved);
    } catch { /* private mode */ }
    const onAcct = (e: Event) => {
      const id = String((e as CustomEvent).detail ?? "");
      if (id) setDetected(id);
    };
    window.addEventListener(evt, onAcct);
    return () => window.removeEventListener(evt, onAcct);
  }, [broker]);
  const liveAccount = envAccount || detected;
  // Only a real, explicitly-configured paper account is usable. A fabricated
  // "DU…" id would make every /portfolio/{acct}/* call fail, so if it is unset
  // paper mode is disabled entirely rather than guessing an account id.
  // IBKR only: the paper account is an IBKR account number, and E*TRADE's
  // sandbox is selected by the proxy's env, not by a toggle in the terminal.
  const paperAccount = broker === "ibkr" ? (import.meta.env.VITE_IBKR_PAPER_ACCOUNT_ID ?? "") : "";
  const paperConfigured = paperAccount.length > 0;

  const [isPaper, setIsPaperState] = useState(() => {
    if (typeof window === "undefined" || !paperConfigured) return false;
    return localStorage.getItem("nova_trading_mode") === "paper";
  });

  // Guard: never enable paper mode when no paper account is configured.
  const setIsPaper = (value: boolean) => setIsPaperState(value && paperConfigured);

  const currentAccount = isPaper && paperConfigured ? paperAccount : liveAccount;

  useEffect(() => {
    localStorage.setItem("nova_trading_mode", isPaper ? "paper" : "live");
    // Never push "" — that would clobber an account ibkr.ts just detected.
    if (currentAccount) setIBKRAccount(currentAccount);
  }, [isPaper, currentAccount]);

  return (
    <TradingContext.Provider value={{ isPaper, setIsPaper, paperConfigured, liveAccount, paperAccount, currentAccount }}>
      {children}
    </TradingContext.Provider>
  );
}

export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) {
    throw new Error("useTrading must be used within a TradingProvider");
  }
  return context;
}
