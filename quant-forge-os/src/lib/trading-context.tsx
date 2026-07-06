import React, { createContext, useContext, useState, useEffect } from "react";
import { setIBKRAccount } from "./api/ibkr";

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
  const liveAccount = import.meta.env.VITE_IBKR_ACCOUNT_ID ?? "U25901412";
  // Only a real, explicitly-configured paper account is usable. A fabricated
  // "DU…" id would make every /portfolio/{acct}/* call fail, so if it is unset
  // paper mode is disabled entirely rather than guessing an account id.
  const paperAccount = import.meta.env.VITE_IBKR_PAPER_ACCOUNT_ID ?? "";
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
    setIBKRAccount(currentAccount);
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
