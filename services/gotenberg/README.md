# Gotenberg on Cloudflare Containers

Hosts [Gotenberg](https://gotenberg.dev) as a Cloudflare Container, fronted by a
Worker that adds a shared-secret gate. The API worker/`apps/worker` converts
XLSX certificate templates to PDF by POSTing to
`${GOTENBERG_URL}/forms/libreoffice/convert` (see
`packages/certificate-xlsx-template/src/conversion.ts`). On Vercel's serverless
runtime there is no LibreOffice, so a reachable Gotenberg is required in prod.

This folder is **not** part of the pnpm workspace (the workspace globs only
`apps/*` and `packages/*`); it has its own `package.json` and is deployed with
Wrangler, independent of the Vercel build.

## Prerequisites

- Cloudflare account on the **Workers Paid** plan (Containers require it).
- A local **Docker daemon** running (`wrangler deploy` builds the image).
- `wrangler` authenticated (`npx wrangler login`).

## Deploy

```bash
cd services/gotenberg
npm install            # if a version errors: npm i @cloudflare/containers@latest wrangler@latest @cloudflare/workers-types@latest

npx wrangler login     # interactive (your Cloudflare auth)

# set the shared secret the caller must present (generate a strong random value)
openssl rand -hex 32 | npx wrangler secret put GOTENBERG_TOKEN

# build the Docker image, push to Cloudflare's registry, deploy Worker+container
npx wrangler deploy
```

`wrangler deploy` prints the deployed URL, e.g.
`https://calibrafacil-gotenberg.<account>.workers.dev` (or attach a custom
domain/route in `wrangler.jsonc`).

## Wire it into the app (Vercel — `calibra-facil-api`, Production)

The worker runs as functions inside the `calibra-facil-api` Vercel project.

```bash
# from repo root, with the api project linked (apps/api/.vercel)
printf 'https://calibrafacil-gotenberg.<account>.workers.dev' \
  | vercel env add GOTENBERG_URL production --cwd apps/api --scope calibra-facil
printf '<the same secret you set above>' \
  | vercel env add GOTENBERG_TOKEN production --sensitive --cwd apps/api --scope calibra-facil
```

Then redeploy the API (any `apps/api` change, since the ignore-step skips
no-op redeploys). The converter picks up both: it sends `X-Gotenberg-Token`
when `GOTENBERG_TOKEN` is set, and the Worker rejects anything else with 401.

## Verify

```bash
TOKEN=<secret>
# minimal LibreOffice round-trip (expects a PDF / HTTP 200)
curl -s -o /tmp/out.pdf -w '%{http_code}\n' \
  -H "X-Gotenberg-Token: $TOKEN" \
  -F "files=@some.xlsx" \
  https://calibrafacil-gotenberg.<account>.workers.dev/forms/libreoffice/convert
# without the header -> 401
```

## Notes

- **Sizing/cost:** `standard-2` (1 vCPU / 6 GiB) with `sleepAfter = "10m"` →
  near-zero cost when idle; cold start a few seconds. Bump `instance_type` /
  `max_instances` or use `getRandom()` in `src/index.ts` for more parallelism.
- **Pin the image** (`gotenberg/gotenberg:8.x.y`) in the `Dockerfile` once a
  version is validated.
- **HTML->PDF (future):** the service-order/label PDFs still render via headless
  Chromium inside the Vercel function (`@sparticuz/chromium-min`). Gotenberg can
  also do HTML->PDF (`/forms/chromium/convert/html`); routing those through this
  same service later would remove the in-function Chromium pack. That needs an
  app-side code change and is out of scope here.
