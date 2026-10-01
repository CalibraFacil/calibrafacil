import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

// Project site (landing, content pages and the public uncertainty calculator).
// No basePath: it serves its paths at the root of its own deployment.
const config: NextConfig = {
  reactStrictMode: true,
  // Next writes its own AGENTS.md/CLAUDE.md into the app on dev start. The
  // repo already documents its conventions at the root, and a generated
  // app-level copy contradicts them.
  agentRules: false,
  // @calibra-facil/math-engine ships raw TypeScript (its "main" is src/index.ts)
  // so the public calculator can run the product's own GUM engine in the
  // browser instead of a second implementation written for marketing.
  transpilePackages: ["@calibra-facil/math-engine"],
  experimental: {
    // math-engine is authored NodeNext-style: its internal specifiers carry a
    // ".js" suffix that resolves to the ".ts" source next to it. Bun (api,
    // worker) and Vite (web, vitest) do that mapping natively; webpack needs
    // it spelled out, and Turbopack has no equivalent option today — which is
    // why dev and build are pinned to --webpack in package.json. Dropping the
    // pin means shipping a compiled dist from math-engine, so the pin stays
    // until there is a reason to take on that build step.
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  // Dev only: extra origins (another device on your network, a tunnel) that
  // may load /_next assets from the dev server, comma-separated in
  // NEXT_DEV_ALLOWED_ORIGINS. Ignored in production.
  allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Serve the documentation (apps/docs, built with basePath "/docs") under the
  // same host when DOCS_ORIGIN points at its deployment.
  async rewrites() {
    const docsOrigin = process.env.DOCS_ORIGIN?.replace(/\/+$/, "");
    if (!docsOrigin) return [];
    return [
      { source: "/docs", destination: `${docsOrigin}/docs` },
      { source: "/docs/:path*", destination: `${docsOrigin}/docs/:path*` },
    ];
  },
};

export default config;
