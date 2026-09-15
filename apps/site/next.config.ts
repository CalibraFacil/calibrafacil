import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

// Marketing site served at calibrafacil.com/precos + /recursos/* (proxied from
// apps/web via Vercel rewrites). No basePath: it serves those paths at the root
// of its own deployment and apps/web maps the public paths onto it. The Vite
// landing keeps owning "/" until the homepage is ported here (staged cutover).
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
  // Dev only: the landing is usually reviewed from another device on the
  // tailnet (phone, laptop), which Next otherwise rejects as a cross-origin
  // dev request and refuses to serve /_next assets to. Ignored in production.
  allowedDevOrigins: [
    "*.tailnet-example.ts.net",
    "devbox.example.ts.net",
    "100.64.0.10",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
