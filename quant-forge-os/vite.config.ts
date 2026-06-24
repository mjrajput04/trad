// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      proxy: {
        "/ibkr": {
          target: "https://backend.nassphx.com:7175",
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: { 
            "backend.nassphx.com": "localhost",
            ".backend.nassphx.com": "localhost"
          },
          cookiePathRewrite: { "*": "/" },
          headers: { 
            "origin": "https://backend.nassphx.com:7175",
            "referer": "https://backend.nassphx.com:7175/"
          },
          rewrite: (path) => path.replace(/^\/ibkr/, "/v1/api"),
        },
        "/sso": {
          target: "https://backend.nassphx.com:7175",
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: { 
            "backend.nassphx.com": "localhost",
            ".backend.nassphx.com": "localhost"
          },
          cookiePathRewrite: { "*": "/" },
          headers: { 
            "origin": "https://backend.nassphx.com:7175",
            "referer": "https://backend.nassphx.com:7175/"
          },
        },
      },
    },
  },
});
