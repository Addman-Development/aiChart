import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react-swc"
import tailwindcss from "@tailwindcss/vite"

export default ({ mode }) => {
  // Load app-level env vars to node-level env vars.
  process.env = { ...process.env, ...loadEnv(mode, `${process.cwd()}/..`) };

  let port = process.env.VITE_APP_CLIENT_PORT || 4018;

  process.env.VITE_APP_VERSION = process.env.npm_package_version;

  return defineConfig({
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
