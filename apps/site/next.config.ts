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
