import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The public origin, used for the canonical URL, Open Graph tags, robots.txt
// and the sitemap. A fork hosting its own copy sets SITE_URL at build time.
const SITE_URL = (process.env.SITE_URL ?? "https://calibrafacil.com").replace(
  /\/+$/,
  "",
);

// Absolute URLs only exist at build time, so they are written into
// index.html and into the two crawler files here instead of in the app.
function siteUrl(): Plugin {
  return {
    name: "calibra-site-url",
    transformIndexHtml(html) {
      return html.replaceAll("%SITE_URL%", SITE_URL);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\nSitemap: ${SITE_URL}/docs/sitemap.xml\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc></url>\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), siteUrl()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // Extra hostnames the dev server answers to (tunnels, LAN devices),
    // comma-separated. Localhost always works.
    allowedHosts: (process.env.VITE_DEV_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  },
});
