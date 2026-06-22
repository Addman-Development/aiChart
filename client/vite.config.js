import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react-swc"
import tailwindcss from "@tailwindcss/vite"

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
