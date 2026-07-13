// Light/dark theme switcher. Dark is the default (the :root palette); light is
// applied by putting .light on <html>, which swaps every CSS variable in
// styles.css. Persisted in localStorage; an inline script in __root.tsx applies
// it before first paint so there's no flash.

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

export const THEME_KEY = "nova_theme";

const listeners = new Set<() => void>();

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

// Browser-chrome tint (mobile address bar / PWA title bar) per theme.
export const THEME_COLORS: Record<Theme, string> = { dark: "#0c0c14", light: "#f2f3f7" };

export function setTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", t === "light");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[t]);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode — theme just won't persist */
  }
  listeners.forEach((l) => l());
}

/** Current theme + toggle. Re-renders subscribers when the theme flips. */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
    () => "dark" as Theme
  );
  return [theme, () => setTheme(theme === "light" ? "dark" : "light")];
}
