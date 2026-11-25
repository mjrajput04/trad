// THE broker layer the app talks to. Everything above this file is
// broker-agnostic; everything below it is not.
//
// Two implementations sit behind it — ibkr.ts (Client Portal Gateway) and
// etrade.ts (OAuth 1.0a). etrade.ts was written as a drop-in for ibkr.ts: every
// export matches in name, signature and return shape, and it absorbs the three
// structural differences (no conid, no native brackets, no Java gateway) so
// nothing upstream can tell which broker is answering.
//
// The choice is per browser and read on EVERY call rather than captured once,
// so switching desks takes effect immediately — no reload, no rebuild, and a
// request already in flight finishes against the broker that started it.
//
// Only the symbols the app actually uses are forwarded. Adding a call here is
// the deliberate moment to check the other broker supports it too.

import { activeBroker } from "@/lib/broker";
import * as ibkr from "./ibkr";
import * as etrade from "./etrade";

/** The shape both implementations satisfy. IBKR is the reference. */
type BrokerApi = typeof ibkr;

const impl = (): BrokerApi =>
  activeBroker() === "etrade" ? (etrade as unknown as BrokerApi) : ibkr;

/* ---------------------------------------------------------------- types */
// Structurally identical across both modules; IBKR's are the canonical ones.
export type {
  AuthStatus,
  ChartBar,
  OptionContract,
  OptionMeta,
  OptionQuote,
  OrderStatus,
  PlaceOrderParams,
  Position,
  Snapshot,
  SymbolQuote,
  Trade,
} from "./ibkr";

/* ------------------------------------------------------------ session */

/**
 * Where this broker wants the user to go to connect.
 *
 * A function, not a constant: IBKR sends them to the gateway's own sign-in page
 * on another host, E*TRADE keeps the OAuth dance on our Broker page, and the
 * answer has to follow a switch made after the module was loaded.
 */
export const gatewayLoginUrl = (): string => impl().GATEWAY_LOGIN_URL;

export const getAuthStatus = (...a: Parameters<BrokerApi["getAuthStatus"]>) => impl().getAuthStatus(...a);
export const ensureSession = (...a: Parameters<BrokerApi["ensureSession"]>) => impl().ensureSession(...a);
export const startSessionKeepalive = (...a: Parameters<BrokerApi["startSessionKeepalive"]>) => impl().startSessionKeepalive(...a);
export const tickle = (...a: Parameters<BrokerApi["tickle"]>) => impl().tickle(...a);

/* ------------------------------------------------------------ account */

// Named for IBKR because the whole app already is; E*TRADE's layer keeps the
// same storage key and event so trading-context needs nothing but this import.
export const getIBKRAccount = (...a: Parameters<BrokerApi["getIBKRAccount"]>) => impl().getIBKRAccount(...a);
export const setIBKRAccount = (...a: Parameters<BrokerApi["setIBKRAccount"]>) => impl().setIBKRAccount(...a);
export const invalidatePositionsCache = (...a: Parameters<BrokerApi["invalidatePositionsCache"]>) => impl().invalidatePositionsCache(...a);

export const getAccountSummary = (...a: Parameters<BrokerApi["getAccountSummary"]>) => impl().getAccountSummary(...a);
export const getPositions = (...a: Parameters<BrokerApi["getPositions"]>) => impl().getPositions(...a);
export const getOrders = (...a: Parameters<BrokerApi["getOrders"]>) => impl().getOrders(...a);
export const getTrades = (...a: Parameters<BrokerApi["getTrades"]>) => impl().getTrades(...a);

/* -------------------------------------------------------- market data */

export const getQuotes = (...a: Parameters<BrokerApi["getQuotes"]>) => impl().getQuotes(...a);
export const getChartData = (...a: Parameters<BrokerApi["getChartData"]>) => impl().getChartData(...a);
export const searchSymbols = (...a: Parameters<BrokerApi["searchSymbols"]>) => impl().searchSymbols(...a);
export const resolveConids = (...a: Parameters<BrokerApi["resolveConids"]>) => impl().resolveConids(...a);

/* -------------------------------------------------------------- options */

export const getOptionMeta = (...a: Parameters<BrokerApi["getOptionMeta"]>) => impl().getOptionMeta(...a);
export const getOptionStrikes = (...a: Parameters<BrokerApi["getOptionStrikes"]>) => impl().getOptionStrikes(...a);
export const getOptionQuotes = (...a: Parameters<BrokerApi["getOptionQuotes"]>) => impl().getOptionQuotes(...a);
export const resolveOptionContracts = (...a: Parameters<BrokerApi["resolveOptionContracts"]>) => impl().resolveOptionContracts(...a);
export const getOptionChain = (...a: Parameters<BrokerApi["getOptionChain"]>) => impl().getOptionChain(...a);
export const findOptionPlay = (...a: Parameters<BrokerApi["findOptionPlay"]>) => impl().findOptionPlay(...a);
// Pure maths over a strike list — same answer whichever broker supplied it.
export const pickNearestStrikes = ibkr.pickNearestStrikes;

/* --------------------------------------------------------------- orders */

export const placeOrder = (...a: Parameters<BrokerApi["placeOrder"]>) => impl().placeOrder(...a);
export const cancelOrder = (...a: Parameters<BrokerApi["cancelOrder"]>) => impl().cancelOrder(...a);
export const cancelWorkingOrders = (...a: Parameters<BrokerApi["cancelWorkingOrders"]>) => impl().cancelWorkingOrders(...a);
export const closePosition = (...a: Parameters<BrokerApi["closePosition"]>) => impl().closePosition(...a);
export const protectPosition = (...a: Parameters<BrokerApi["protectPosition"]>) =>
  impl().protectPosition(...a);
// Pure arithmetic over numbers already on screen — same answer either side, so
// it needs no broker behind it.
export const trailPreview = ibkr.trailPreview;
export const verifyOrderLive = (...a: Parameters<BrokerApi["verifyOrderLive"]>) => impl().verifyOrderLive(...a);

/* ------------------------------------------------- E*TRADE OAuth only */
// IBKR has no equivalent: its sign-in happens on the gateway's own page, so
// these throw rather than pretend. Only the Broker page calls them, and only
// when E*TRADE is the active broker.

const etradeOnly = (name: string) => {
  throw new Error(`${name} is an E*TRADE step; Interactive Brokers signs in at its own gateway.`);
};

export const startAuth = (): Promise<{ authorizeUrl: string }> =>
  activeBroker() === "etrade" ? etrade.startAuth() : etradeOnly("startAuth");

export const completeAuth = (verifier: string) =>
  activeBroker() === "etrade" ? etrade.completeAuth(verifier) : etradeOnly("completeAuth");

export const logoutBroker = () =>
  activeBroker() === "etrade" ? etrade.logout() : Promise.resolve();

export const listAccounts = () =>
  activeBroker() === "etrade" ? etrade.listAccounts() : Promise.resolve([]);
