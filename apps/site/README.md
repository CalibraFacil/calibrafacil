# @calibra-facil/site

The project website: one static page about the open-source project, built with Vite and React
and prerendered to HTML at build time.

```bash
pnpm --dir apps/site dev       # http://localhost:3002
pnpm --dir apps/site build     # static site in apps/site/dist
pnpm --dir apps/site preview   # serve the build locally
```

`pnpm build` runs `vite build`, then `scripts/prerender.mjs` renders the page into
`dist/index.html` and writes `dist/404.html`. The browser bundle hydrates that markup, so the page
reads without JavaScript. The canonical URL, the Open Graph tags, `robots.txt` and `sitemap.xml`
use `SITE_URL` (default `https://calibrafacil.com`); set it at build time to host a copy elsewhere.

## Deploying

`dist/` is plain static files, so any static host works. `wrangler.jsonc` deploys it to
Cloudflare Workers as static assets only, which costs nothing on the free plan:

```bash
pnpm --dir apps/site build
cd apps/site && pnpm dlx wrangler deploy
```

With Cloudflare's Git integration (Workers Builds), set the root directory to `apps/site`, the
build command to `pnpm run build` and the deploy command to `npx wrangler deploy`.
`public/_headers` sets the security and cache headers; `public/_redirects` sends the old content
pages to the home page.
