import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// 本機開發：把 /__gas_proxy 轉到 VITE_GAS_WEBAPP_URL，避開瀏覽器 CORS
const GAS_PROXY = "/__gas_proxy";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rawBase = env.VITE_BASE?.trim();
  const base = rawBase && rawBase.length > 0 ? rawBase : "/";

  let gasPathname = "";
  try {
    const u = new URL(env.VITE_GAS_WEBAPP_URL || "https://example.invalid/");
    if (u.hostname.includes("google.com") || u.hostname.includes("googleusercontent.com")) {
      gasPathname = u.pathname + u.search;
    }
  } catch {
    gasPathname = "";
  }

  return {
    base,
    server: {
      proxy: gasPathname
        ? {
            [GAS_PROXY]: {
              target: "https://script.google.com",
              changeOrigin: true,
              secure: true,
              rewrite: () => gasPathname,
            },
          }
        : {},
    },
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "icon.png"],
        manifest: {
          name: "送祝福",
          short_name: "送祝福",
          description: "送祝福 · 線上同步記錄",
          theme_color: "#1a5f4a",
          background_color: "#f5f0e8",
          display: "standalone",
          start_url: base,
          icons: [
            {
              src: "icon.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icon.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        },
      }),
    ],
  };
});
