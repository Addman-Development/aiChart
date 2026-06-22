import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react-swc"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

export default ({ mode }) => {
  // Load app-level env vars to node-level env vars.
  process.env = { ...process.env, ...loadEnv(mode, `${process.cwd()}/..`) };

  let port = process.env.VITE_APP_CLIENT_PORT || 4018;

  process.env.VITE_APP_VERSION = process.env.npm_package_version;

  // Derive the base path from VITE_APP_CLIENT_HOST so assets and routing
  // work when the app is deployed under a sub-path (e.g. /smart-chart).
  let base = "/";
  try {
    const clientHost = process.env.VITE_APP_CLIENT_HOST;
    if (clientHost) {
      const { pathname } = new URL(clientHost);
      if (pathname && pathname !== "/") {
        base = pathname.endsWith("/") ? pathname : pathname + "/";
      }
    }
  } catch {
    // keep default "/"
  }

  return defineConfig({
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Seamlessly swap in new builds; the injected registration auto-reloads.
        registerType: "autoUpdate",
        injectRegister: "auto",
        // Precache these extra root assets so the install + offline shell is complete.
        includeAssets: ["favicon.png", "apple-touch-icon-180x180.png"],
        manifest: {
          name: "Edison — SmartChart",
          short_name: "Edison",
          description: "Connect your databases and APIs to build live charts and dashboards.",
          theme_color: "#ECEFF1",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "any",
          // start_url / scope are derived from Vite's `base` automatically.
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"],
          // The main bundle is large (~8MB); raise the precache ceiling so the
          // app shell is fully cached for offline/instant reloads.
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          // SPA fallback for client-side routes. The API lives on a separate
          // origin (VITE_APP_API_HOST) so it is never intercepted here; the
          // denylist is a safety net for any same-origin API proxying.
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//, /\/[^/?]+\.[^/?]+$/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.origin === "https://rsms.me",
              handler: "CacheFirst",
              options: {
                cacheName: "rsms-fonts",
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
              handler: "StaleWhileRevalidate",
              options: { cacheName: "google-fonts-stylesheets" },
            },
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-webfonts",
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          // Keep the SW out of `bun run dev` to avoid stale-cache confusion while developing.
          enabled: false,
        },
      }),
    ],
    server: {
      port,
    },
    preview: {
      port,
      host: "0.0.0.0"
    },
  });
};
