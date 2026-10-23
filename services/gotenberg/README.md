# Gotenberg on Cloudflare Containers

Hosts [Gotenberg](https://gotenberg.dev) as a Cloudflare Container, fronted by a
Worker that adds a shared-secret gate. `apps/worker` renders certificates and documents from HTML to PDF by POSTing to
`${GOTENBERG_URL}/forms/chromium/convert/html`. Any Gotenberg 8 instance works
(locally, `docker-compose.yml` runs one); this folder is one way to host it on
Cloudflare Containers.

This folder is **not** part of the pnpm workspace (the workspace globs only
`apps/*` and `packages/*`); it has its own `package.json` and is deployed with
Wrangler, independent of the app builds.

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

## Wire it into the app

Set `GOTENBERG_URL` to the deployed Worker URL and `GOTENBERG_TOKEN` to the
secret you set above, in the environment of the API and of the worker, then
restart them. The converter picks up both: it sends `X-Gotenberg-Token`
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
