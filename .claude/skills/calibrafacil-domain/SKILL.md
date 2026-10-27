---
name: calibrafacil-domain
description: >-
  Ground truth for the Calibra Fácil codebase (ISO/IEC 17025 calibration-lab
  SaaS). Load at the start of any feature, spec, or review session so a cold
  context does not re-derive — and mis-guess — the architecture, the regulated
  "cut lines", the real commands, or the regulatory vocabulary. Use whenever the
  task touches calibration, certificates, uncertainty/GUM, accreditation,
  signing, RBAC/tenancy, or any /goal or /loop planning.
---

# Calibra Fácil — Domain Skill

ISO/IEC 17025 calibration-laboratory management system. Turborepo + pnpm
monorepo. The same React frontend runs **cloud** and **desktop/offline**; most
architecture exists to keep the two in parity. Read `CLAUDE.md` and `AGENTS.md`
for the full rule list — this skill is the fast, verified orientation plus the
regulated boundaries.

## Verified commands (quote these, don't guess)

| Need                    | Command                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install / runtime       | `pnpm@11`, Node `>=24`. API + worker run under **Bun**; web/portal/local-server under Node+Vite/tsx.                                                                                                                                                                                                                                         |
| Lint                    | `pnpm lint` → `turbo run lint` → **oxlint** (NOT ESLint; config `.oxlintrc.json`)                                                                                                                                                                                                                                                            |
| Typecheck               | `pnpm check-types` → per-package **`tsrs`** (Rust port of the TS 7 compiler, via `scripts/typecheck.mjs`; falls back to native `tsc` from `typescript@7` where tsrs has no binary). `pnpm check-types:tsc` forces `tsc` (parity). The Next.js app (`apps/docs`) stays on `typescript@6.0.3` and `tsc` (its tooling imports the compiler API) |
| Format                  | `pnpm format` → `prettier --write "**/*.{ts,tsx,md}"`                                                                                                                                                                                                                                                                                        |
| Repo gates              | `pnpm format:check`, `pnpm knip` (unused files/deps), `pnpm check:cycles` (madge), `pnpm build`; the architecture rules are lint rules too (`calibra/*` plugin)                                                                                                                                                                              |
| All tests               | `pnpm turbo test` (Vitest, per package; there is no root `test` script)                                                                                                                                                                                                                                                                      |
| One package, no watch   | `pnpm --dir apps/api test:run`                                                                                                                                                                                                                                                                                                               |
| **One file + one test** | `pnpm --dir apps/api test:run src/routes/__tests__/signatures.spec.ts -t "test name"`                                                                                                                                                                                                                                                        |
| Migrations              | Hand-written: `packages/db/drizzle/NNNN_name.sql` + an entry in `drizzle/meta/_journal.json`; apply with `cd packages/db && pnpm db:bootstrap` (new DB: schema push + `sql/schema-extras.sql`; existing DB: migrate) or `pnpm db:migrate`. **Never** `drizzle-kit generate` / `pnpm db:generate` (unusable past the early snapshots)         |

- **Regulated test files are `*.spec.ts`** (e.g. `apps/api/vitest.config.ts` →
  `include: ["src/**/*.spec.ts", "test/integration/*.spec.ts"]`, most of
  `packages/signing/src/*.spec.ts`). Other packages also use `*.test.ts`; prefer
  `.spec.ts` for api/signing. Real-database integration specs are
  `pnpm --dir apps/api test:integration` (disposable local Postgres).
- **No JSON/JUnit reporter is configured.** A `/goal` evaluator's only reliable
  signal today is the **process exit code** plus the default summary line. If you
  need machine-parseable output, pass `--reporter=json --outputFile=…` explicitly.

## Architecture map (real paths — "decompose by surface")

- **Data:** `packages/db` (Drizzle/Postgres, `src/schema.ts`, hand-written `drizzle/`
  migrations, `sql/schema-extras.sql`); `packages/local-db` (SQLite offline + outbox).
- **Domain validation / shared:** `packages/schemas` (Zod), `packages/shared`
  (`src/finance.ts`, `src/accreditation.ts`, units, CNPJ).
- **Calibration math:** `packages/math-engine` (parser, evaluator, `uncertainty/`,
  `gum/`, `numeric/`, `audit/`).
- **Signing / documents:** `packages/signing`, `packages/documents`,
  `packages/label-rendering`, `packages/certificate-data`,
  `packages/method-definition`, `packages/method-templates`.
- **Auth / access:** `packages/auth` (`access.ts`, `lab-access.ts`, Better-Auth).
- **API:** `apps/api` (Hono — `src/app.ts`, `src/routes/`, `src/modules/`,
  `src/middleware/`, `src/services/`, `src/lib/`); runs under Bun
  (`src/bun.ts`), self-hosted.
- **Frontends:** `apps/web` (lab dashboard; thin `src/routes/` adapters +
  `src/features/<domain>/`), `apps/portal` (cloud-only client portal),
  `apps/docs` (user docs), `apps/site` (project website).
- **Jobs / offline:** `packages/jobs-core` (dispatcher + handlers) driven by `apps/worker`
  (in-process in dev, or the always-on worker draining the database queue);
  `apps/desktop` (Electron), `apps/local-server` + `packages/local-db` (SQLite, outbox, sync).
- **Validation dossiers:** `validation/math-engine/v<version>/dossier.tex` (+ `manifest.json`);
  the current version is `ENGINE_VERSION` in `packages/math-engine/src/engine/options.ts`.

## Regulated cut lines (CONFIRMED — the hard boundary for /goal and /loop)

> These classifications govern whether a surface may be touched by an unattended
> loop. **When in doubt, treat a surface as pair-don't-loop.**
>
> **Owner override.** The owner may explicitly authorize a loop over a cut-line
> (pair-don't-loop) surface. Absent that explicit authorization the default stands:
> pair, do not loop. When it is authorized, the safeguards are mandatory: (1) tests
> first (EARS criteria with failing tests before any code), (2) legacy
> compatibility (existing records, frozen certificate inputs and approved
> calibrations keep working and stay immutable), (3) an independent `spec-verifier`
> pass over code it did not write, and (4) the PR is flagged for owner review and is
> never merged unattended.

| Surface                                                                                              | Real location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Class                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Calibration approval workflow** (separation of duties, "approved is immutable")                    | `packages/auth/src/access.ts` (`CalibrationState` draft→submitted→in_review→approved→rejected; `calibrationWorkflowPermissions`, `canPerformCalibrationAction`); enforced in `apps/api/src/middleware/permission.ts` (`requireCalibrationAction`); approver columns in `packages/db/src/schema.ts` (`technicalReviewedBy`, `approvedBy`)                                                                                                                                                                                                                                                                                          | **pair-don't-loop**                                                                                                                                                                  |
| **ICP-Brasil A1 signing / credential custody**                                                       | `packages/signing/` (`signer.ts` PKCS#12+PAdES, `chain-validation.ts`, `verify.ts`, `timestamp.ts`, `encryption.ts`); schema `organizationSigningCertificate` (AES-256-GCM encrypted P12 + password)                                                                                                                                                                                                                                                                                                                                                                                                                              | **pair-don't-loop**                                                                                                                                                                  |
| **RBAC / multi-tenant policy layer**                                                                 | `packages/auth/src/access.ts` (Better-Auth `createAccessControl`, roles); enforced in `apps/api/src/middleware/permission.ts` (`requirePermission`, `requireRole`, `requireOrgType`, `requireOrganization`) + `resolveMemberUnitScope` in `apps/api/src/lib/units.ts`                                                                                                                                                                                                                                                                                                                                                             | **pair-don't-loop**                                                                                                                                                                  |
| **GUM uncertainty math engine**                                                                      | `packages/math-engine` (`gum/`, `uncertainty/type-a.ts`, `type-b.ts`, `numeric/decimal.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **loopable-with-verifier** — only when gated by the numeric oracle tests **and** a dossier regeneration (`validation/math-engine/v<ENGINE_VERSION>/`); see the source-pin gate below |
| **Accreditation vigência (validity window) vs capability (accredited scope), and the seal decision** | Modeled. `organization.accreditationActive` / `accreditationNumber` / `accreditationBody` / `accreditationValidFrom` / `accreditationValidUntil` (calendar days of the lab; migration `0085_accreditation_vigencia.sql`); accredited scope lines with CMC in `accreditedScopeLine` (`0098`–`0100`), `calibrationMethod.accreditedScope`, scope enforcement default `0128`; pure logic in `packages/shared/src/accreditation.ts` (`getAccreditationStatus`, `decideAccreditationSeal`, `shouldRenderAccreditationSeal`) and `scope-compliance.ts`. The seal decision is taken once at approval and frozen in the certificate input | **pair-don't-loop** (it decides whether a certificate may carry the accreditation mark; classified conservatively, was previously listed as not-yet-built)                           |
| **PSIE state machine + credential-custody boundary**                                                 | Not in code (no PSIE module or tables; legal-metrology seals/lacres are a roadmap segment)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **doesn't-exist-yet**                                                                                                                                                                |

**Math-engine gates (all must stay green; never edit them to go green).**
`audit/engine-dossier-gate.spec.ts` (version and reference fingerprint),
`audit/engine-source-pin.spec.ts` (SHA-256 of every non-test engine source file and
five golden propagation results, pinned in the current dossier's `manifest.json`)
and `gum/ea-4-02-examples.spec.ts` (published EA-4/02 M:2022 worked examples at
half a unit of the last published digit). Any byte change under
`packages/math-engine/src` — a comment included — fails the pin: a deliberate
release bumps `ENGINE_VERSION` and `package.json` together, adds
`validation/math-engine/v<new>/` with its own manifest, then runs
`pnpm --filter @calibra-facil/math-engine run engine:pin`. The script refuses to
rewrite evidence already pinned for a version.

## Real conventions (detected, not assumed)

- **Migrations are hand-written and forward-only.** `drizzle-kit generate` does not
  produce usable output past the early snapshots, so do **not** use `pnpm db:generate`.
  A change is `packages/db/drizzle/NNNN_name.sql` (next number, e.g.
  `0131_audit_hash_chain.sql`) plus one entry appended to
  `packages/db/drizzle/meta/_journal.json`: `idx` is the next contiguous integer,
  `when` is strictly greater than the previous entry's, `tag` is the file name
  without `.sql`. Edit `packages/db/src/schema.ts` too, because new databases are
  built from it (the historical chain is not replayable from scratch). Anything
  `schema.ts` cannot express (extension, function, trigger, partial/expression
  index, CHECK constraint, grants/RLS policy) must also go in
  `packages/db/sql/schema-extras.sql`. **Never hand-edit an already-applied
  migration; never renumber.** Apply with `cd packages/db && pnpm db:bootstrap`
  (new DB: schema push + extras; existing DB: migrate) or `pnpm db:migrate`; both run
  as the table owner (`DATABASE_OWNER_URL`, else `DATABASE_URL`).
- **Multi-tenancy = `organizationId` + `unitId` scoping, bound by row-level security.**
  `requireOrganization` establishes the active org/session; `resolveMemberUnitScope`
  resolves the unit scope; every tenant-scoped query MUST filter by `organizationId`
  (and `unitId` where the table is unit-scoped, e.g. `organizationSigningCertificate`).
  Never return rows across tenants. RLS is **enforced by default**
  (`DATABASE_RLS_MODE=enforced`): the API and worker connect as the low-privilege role
  `calibra_app` (`DATABASE_URL`), and every tenant policy binds it. Route handlers query
  through `orgDb(organizationId)` (`apps/api/src/lib/org-db.ts`), or `forOrg` /
  `orgDb(lab).transaction(...)`, so each statement runs in an org-scoped transaction;
  the raw `db` is a lint error in `apps/api/src/routes`. Only the named `systemDb`
  path uses the table owner (`DATABASE_OWNER_URL`): identity, cross-laboratory lookups
  and sweeps, migrations, seeds, the CLI. Each use is a reviewed entry in
  `apps/api/test/integration/tenant-sql-allowlist.ts`. `shadow` is a diagnosis mode,
  not a default. Preserve tenant/org/unit scoping in every change; see
  `docs/architecture/org-bound-db.md`.
- **Uncertainty is never value-only.** `packages/math-engine` is a hybrid
  numeric engine, **not** exact end to end. **Exact** (bigint rationals,
  `numeric/decimal.ts`, decimal mode): formula evaluation with `+ − × ÷` and
  integer powers, symbolic sensitivity coefficients, the Type A mean and sum of
  squares, and the canonical output text. **float64 (IEEE-754 binary64)**:
  everything past a square root or a quantile — standard deviations and Type B
  divisors (√3, √6, √2), the combined variance (GUM Eq. 10/13), `u_c`,
  Welch–Satterthwaite `ν_eff`, the Student-t `k` and `U` — plus transcendental
  functions (`Math.*`, last digit may differ per JS runtime) and the
  numerical-derivative fallback. Never describe it as "exact decimal" or "not
  float" without that split (dossier, "Métodos numéricos" and limitations 2
  and 5). A measurement result carries value **plus** standard/expanded
  uncertainty, the **coverage factor `k`** and (effective) degrees of freedom:
  `coverageFactor` and `expandedUncertainty` are first-class
  (`uncertainty/type-b.ts`, `gum/measurement.ts`); `k` from Student-t via
  `coverageFactorForProbability(p, νeff)` (`gum/statistics.ts`; `ν_eff` is kept
  real, not truncated as EA-4/02 Appendix E does). Results are fingerprinted for
  audit (`audit/`).
- **Bans:** `useEffect` import from `react` is lint-blocked (use derived state /
  data hooks / `use-mount-effect.ts`); `as` type assertions are banned
  (`consistent-type-assertions: never` — use type guards, `satisfies`, schema parse).
- **No third-party telemetry or error tracking** (no Sentry, no replay, no default PII
  collection). Server errors go through `createLogErrorReporter`
  (`packages/shared/src/telemetry`) as one redacted JSON line on stderr; browser route
  errors go to the console. Do not add an error-tracking SDK.
- **API/client contract boundary:** frontends must never import `@calibra-facil/api`
  or `apps/api/*`; go through `@calibra-facil/contracts` + `@calibra-facil/client-runtime`.
- **Instrument-agnostic — do NOT build "scale-centric".** The lab calibrates many
  instrument types (balanças, termômetros, paquímetros, manômetros, torquímetros…).
  Describe an instrument via `assetType` + the generic `displaySpecs`
  (`[{label,value}]`) / `specifications` (jsonb) — present on `asset` and
  `serviceOrderAssetSnapshot`. NEVER hardcode weighing-only fields (capacity/division,
  "Portaria", seals/lacre) as if universal: `portaria` isn't even a column (it lives
  in `displaySpecs`), and `capacity`/`resolution` are weighing-flavored. Legal-metrology
  concepts (lacres/selos Inmetro, PSIE) are a roadmap segment (`docs/estrategia/…`),
  not the default instrument.
- **Regulated workflows are schema-first:** validate with `@calibra-facil/schemas`,
  keep parsing in testable `forms.ts`, not JSX handlers.
- **Tests** live as `*.spec.ts` next to code or under `__tests__/`; Vitest.

## Regulatory vocabulary — use VERBATIM, never paraphrase

The strings below are legal/accreditation identifiers. In **certificates, labels,
seals, and user-facing strings** they must appear exactly; do not "clarify",
translate, expand, or reword them. (Codebase truth: see `packages/shared/src/accreditation.ts`.)

- **NBR ISO/IEC 17025** — accreditation standard (the seal's scheme band, `ACCREDITATION_SEAL_SCHEME` = `"ABNT NBR ISO/IEC 17025"`).
- **Inmetro** — e.g. `"Portaria Inmetro nº 157/2022"` (see `packages/shared/src/format-specifications.test.ts`).
- **Cgcre** — Coordenação Geral de Acreditação (the Brazilian accreditation body).
- **CGCRE / RBC** — accreditation prefix `CAL`; number stored as digits only
  (`normalizeAccreditationNumber`), displayed `"CAL 0123"` (`formatAccreditationNumber`).
- **MP 2.200-2** + **DOC-ICP-15.03** (perfis PAdES ICP-Brasil: AD-RB/AD-RT/AD-RC/AD-RA) —
  the legal/technical basis for `packages/signing`. Signing is a product/legal choice:
  **no Cgcre document requires a digital signature on certificates**
  (DOQ-CGCRE-087, 7.8.2.1(o), only requires _identification_ of the authorizer). Do NOT
  cite **NIT-DICLA-083** for anything: no such document exists. The Cgcre document on
  certified reference materials (MRC) is **DOQ-CGCRE-083 Rev.01**, a DOQ, not a NIT,
  and it is unrelated to digital signatures.
- **NIE-CGCRE-009** — use of the accreditation mark/symbol (electronic use included): the
  document to check for seal rules (`docs/referencias/nie-cgcre-009-simbolo-acreditacao.md`).
- **Rounding / `k` and `ν_eff`** — P14 §5.3 and NIT-DICLA-021 A.6.3: at most two
  significant digits, the value rounded to the last significant digit of `U`; when
  `ν_eff` is used, NIT-DICLA-021 A.6.2 requires printing `k = XX` and `ν_eff = YY`
  (`docs/referencias/nit-dicla-021-incerteza.md`).
- **OIML R 76** — international recommendation for non-automatic weighing
  instruments (balances). Appears in the codebase as free-text references (e.g.
  `"EMA OIML R 76-1, classe III"` in the certificate HTML spec; `"OIML R76"` in
  `certificate-data.test.ts`), not as a controlled constant. Use the exact token from
  the method's `referenceStandards`; confirm spelling/edition with a human before
  putting a new one on a certificate.

## When unsure, ASK — do not guess

For anything that affects **a certificate, an accreditation claim, or access
scoping**, stop and ask the human rather than infer. Specifically:

- regulatory text, accreditation number/scope, seal rendering, or what makes a
  certificate "released" vs technically "approved";
- which role/permission/tenant boundary applies (read it from the RBAC layer
  above; never invent a new one inline);
- coverage factor, distribution, or rounding choices in an uncertainty result;
- anything classified **pair-don't-loop** or **doesn't-exist-yet** above.

A wrong guess here is a regulatory/legal error, not a bug. Guessing is the
failure mode this skill exists to prevent.
