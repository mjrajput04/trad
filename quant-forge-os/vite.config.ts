// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The IBKR gateway is only reachable through the VPS proxy on port 443
// (https://backend.nassphx.com). Port 7175 is the gateway's local port on the
// VPS and is NOT exposed publicly.
const GATEWAY = process.env.VITE_IBKR_GATEWAY_URL ?? "https://backend.nassphx.com";

export default defineConfig({
  nitro: { preset: "node-server" },
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      proxy: {
        "/ibkr": {
          target: GATEWAY,
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: { "*": "localhost" },
          cookiePathRewrite: { "*": "/" },
          rewrite: (path) => path.replace(/^\/ibkr/, "/v1/api"),
        },
        "/sso": {
          target: GATEWAY,
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: { "*": "localhost" },
          cookiePathRewrite: { "*": "/" },
        },
      },
    },
  },
});
