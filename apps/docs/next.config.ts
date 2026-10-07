import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

import { docsBasePath } from "./lib/site";

const withMDX = createMDX();

const config: NextConfig = {
  reactStrictMode: true,
  // Plain HTML files in out/: the project site's build (apps/site) publishes
  // them under calibrafacil.com/docs, so the site's _headers and _redirects
  // apply to the docs too.
  output: "export",
  // Docs live under /docs so they can share a host with the project site.
  // basePath prefixes every route, asset and Next <Link> (Fumadocs uses Next
  // Link, so source.baseUrl stays "/").
  basePath: docsBasePath,
  // A static export has no image optimizer.
  images: { unoptimized: true },
  // Extra origins (a tunnel, another device) allowed to talk to `next dev`,
  // comma-separated in NEXT_DEV_ALLOWED_ORIGINS. Without them Next blocks
  // /_next/webpack-hmr and /_next/static requests from non-localhost origins.
  allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export default withMDX(config);
