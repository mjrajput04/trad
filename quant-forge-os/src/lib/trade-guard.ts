// Runtime trading permission, kept dependency-free so the broker layer can
// import it without pulling in Supabase or react-query.
//
// The value is mirrored from the `trading_enabled` app flag by the app layout
// (see app-flags.ts). The broker layer checks it before submitting anything, so
// disabling trading is enforced at the request layer — not only by graying out
// a button that could be re-enabled in devtools.

let runtimeTradingAllowed = true;

export function setRuntimeTradingAllowed(v: boolean) {
  runtimeTradingAllowed = v;
}

export function isRuntimeTradingAllowed() {
  return runtimeTradingAllowed;
}

export const TRADING_DISABLED_MESSAGE =
  "Trading is switched off for this account. Ask the account owner to enable it.";
