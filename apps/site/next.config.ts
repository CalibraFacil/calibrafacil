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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
