# Calibra Fácil

Open-source management software for calibration laboratories working under
**ISO/IEC 17025**: calibration workflow, GUM uncertainty calculations, certificates with
review/approval and ICP-Brasil digital signatures, a client portal, and a desktop app that
keeps working offline.

> **Em português:** o Calibra Fácil é um software de código aberto (licença MIT) para
> laboratórios de calibração sob a ISO/IEC 17025 e oficinas permissionárias do Inmetro.
> Cobre o fluxo de calibração, o cálculo de incerteza conforme o GUM, certificados com
> revisão e aprovação assinados em ICP-Brasil, o portal do cliente e um aplicativo desktop
> que funciona offline. A interface é em português; o código e a documentação técnica, em
> inglês. Para rodar localmente, siga o [Quick start](#quick-start).

Calibra Fácil started as a commercial SaaS used in production by accredited laboratories in
Brazil. It is now maintained as an open-source project, on a best-effort basis, by its
community.

> **No warranty.** The software is provided "as is" under the [MIT License](./LICENSE). Each
> laboratory is solely responsible for validating it for its own use (ISO/IEC 17025:2017
> §7.2.2 and §7.11) and for the results and certificates it issues. The
> [validation dossiers](./validation/math-engine/) are technical references, not approvals.

## Features

- **Calibration workflow** — draft → execution → technical review → approval, with distinct
  roles, an immutable approved version and amendments that keep the history.
- **GUM uncertainty engine** ([`packages/math-engine`](./packages/math-engine)) — exact
  decimal arithmetic, Type A/B evaluation, correlated inputs, Welch–Satterthwaite with
  Student-t coverage, reproducible SHA-256 calculation fingerprints and versioned
  validation dossiers.
- **Method catalog** — guide-grounded calibration methods (mass, force, frequency,
  electrical DC, volume, humidity, weighing instruments) compiled from declarative
  definitions with dimensional checks.
- **Certificates** — PDF certificates following ISO/IEC 17025 §7.8, PAdES signatures with an
  ICP-Brasil A1 certificate, public verification page and QR codes.
- **Traceability & quality** — reference standards with validity control, personnel
  competence, non-conformities/CAPA, proficiency tests, SPC charts and calibration-interval
  analysis.
- **Legal metrology** — Inmetro regulation catalog, repair seals and delivery receipts for
  "oficinas permissionárias".
- **Operations** — customers, assets, service orders, quotes, on-site visits, thermal label
  printing (ZPL/TSPL) and optional ERP integration (Conta Azul).
- **Client portal** — customers see their instruments, due dates and certificates, request
  calibrations and approve quotes; custom domains and lab branding.
- **Desktop app** — Electron shell with a local SQLite server, an outbox and conflict
  resolution, so field work continues offline and syncs later.

## Architecture

```
            ┌───────────────┐   ┌───────────────┐   ┌──────────────────────────┐
browser ──▶ │  apps/web     │   │  apps/portal  │   │  apps/desktop            │
            │  lab app      │   │  client portal│   │  Electron + local-server │
            └───────┬───────┘   └───────┬───────┘   │  (SQLite, offline sync)  │
                    │                   │           └────────────┬─────────────┘
                    └─────────┬─────────┴────────────────────────┘
                              ▼
                    ┌───────────────────┐        ┌──────────────────────┐
                    │  apps/api (Hono)  │ ─────▶ │  apps/worker         │
                    │  REST + auth      │  jobs  │  PDFs, e-mails, syncs│
                    └─────────┬─────────┘        └──────────┬───────────┘
                              │                             │
          ┌───────────────────┼───────────────┬─────────────┴──────┐
          ▼                   ▼               ▼                    ▼
     PostgreSQL       S3-compatible      Gotenberg            Resend API
     (Drizzle)        object storage     (HTML → PDF)         (e-mail)
```

| Path                   | What it is                                                        |
| ---------------------- | ----------------------------------------------------------------- |
| `apps/api`             | Hono API: REST routes, Better Auth, cron handlers                 |
| `apps/web`             | Lab app (React 19, Vite, TanStack Router/Query, Tailwind 4)       |
| `apps/portal`          | Client portal                                                     |
| `apps/worker`          | Background jobs: certificate PDFs, signing, e-mails, integrations |
| `apps/desktop`         | Electron desktop shell                                            |
| `apps/local-server`    | Local API for the desktop app, backed by SQLite                   |
| `apps/docs`            | User documentation (Fumadocs on Next.js)                          |
| `apps/site`            | Project website and public uncertainty calculator                 |
| `packages/math-engine` | GUM uncertainty engine (versioned, with validation dossiers)      |
| `packages/db`          | Drizzle schema, SQL migrations and seeds                          |
| `packages/auth`        | Better Auth configuration, roles and permissions                  |
| `packages/signing`     | PAdES/ICP-Brasil certificate signing                              |
| `packages/local-db`    | Offline SQLite store, outbox and conflict records                 |
| `packages/*`           | Contracts, client SDK, schemas, documents, e-mail, notifications… |

Architecture rules worth reading before a first change:
[`CLAUDE.md`](./CLAUDE.md) (big picture),
[`docs/architecture/api-client-contract.md`](./docs/architecture/api-client-contract.md) and
[`docs/architecture/web-frontend-architecture.md`](./docs/architecture/web-frontend-architecture.md).

## Quick start

Requirements: **Node.js 24**, **pnpm 11** (`corepack enable`), **Bun 1.x** and **Docker** with
the Compose plugin. No cloud account is needed.

```bash
git clone https://github.com/CalibraFacil/calibrafacil.git
cd calibrafacil
pnpm install
pnpm setup:dev   # env files, Docker services, migrations, demo laboratory
pnpm dev         # API :3000, lab app :5173, portal :5174
```

Then open <http://localhost:5173> and sign in as **`admin@laboratorio.test`**. Sign-in is
passwordless: the magic link arrives in the local inbox at <http://localhost:8025>. The seed
also creates `revisor@laboratorio.test` (admin) and `tecnico@laboratorio.test` (technician),
so review and approval flows that need two people can be exercised.

`docker-compose.yml` stands in for every cloud dependency:

| Service        | Replaces                    | Address                  |
| -------------- | --------------------------- | ------------------------ |
| `postgres`     | managed PostgreSQL          | `localhost:55432`        |
| `s3`           | Cloudflare R2 / S3          | `http://localhost:59000` |
| `mailpit`      | inbox for every e-mail sent | <http://localhost:8025>  |
| `resend-relay` | the Resend API (→ Mailpit)  | `http://localhost:3025`  |
| `gotenberg`    | PDF rendering               | `http://localhost:3001`  |

`pnpm services:down` stops the containers (data is kept); `pnpm setup:dev --reset` wipes them
and starts over.

## Development

```bash
pnpm dev              # API, lab app and portal
pnpm dev:all          # every app with a dev script (docs, site, desktop, worker…)
pnpm lint             # oxlint (architecture boundaries are lint rules too)
pnpm format           # Prettier
pnpm check-types      # TypeScript (native tsc 7)
TZ=UTC pnpm turbo test                      # unit tests
pnpm --dir apps/api test:integration        # real-Postgres integration tests (Docker)
```

Database migrations are plain SQL in `packages/db/drizzle/`; apply them with
`pnpm --dir packages/db db:bootstrap` (a new database is built from the schema; an existing one
receives the pending migrations).

## Deployment

Calibra Fácil can be self-hosted on any infrastructure that runs Node/Bun, PostgreSQL and an
S3-compatible store, or on Vercel with the included `vercel.json` files. See
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Contributing

Bug reports, fixes, calibration methods and documentation are welcome. Read
[`CONTRIBUTING.md`](./CONTRIBUTING.md) first; questions go to
[GitHub Discussions](https://github.com/CalibraFacil/calibrafacil/discussions). Security
issues: see [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) © 2025–2026 Pedro Seibel and the Calibra Fácil contributors.
