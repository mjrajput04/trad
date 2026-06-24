import React, { createContext, useContext, useState, useEffect } from "react";
import { setIBKRAccount } from "./api/ibkr";

interface TradingContextType {
  isPaper: boolean;
  setIsPaper: (value: boolean) => void;
  liveAccount: string;
  paperAccount: string;
  currentAccount: string;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const [isPaper, setIsPaper] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("nova_trading_mode");
    return saved === "paper";
  });

  const liveAccount = import.meta.env.VITE_IBKR_ACCOUNT_ID ?? "U25901412";
  const paperAccount = import.meta.env.VITE_IBKR_PAPER_ACCOUNT_ID ?? "DU25901412";

  const currentAccount = isPaper ? paperAccount : liveAccount;

  useEffect(() => {
    localStorage.setItem("nova_trading_mode", isPaper ? "paper" : "live");
    setIBKRAccount(currentAccount);
  }, [isPaper, currentAccount]);

  return (
    <TradingContext.Provider value={{ isPaper, setIsPaper, liveAccount, paperAccount, currentAccount }}>
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
