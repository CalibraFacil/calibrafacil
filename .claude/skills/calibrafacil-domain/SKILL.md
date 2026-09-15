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

| Need                    | Command                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install / runtime       | `pnpm@11`, Node `>=24`. API + worker run under **Bun**; web/portal/local-server under Node+Vite/tsx.                                                                                                 |
| Lint                    | `pnpm lint` → `turbo run lint` → **oxlint** (NOT ESLint; config `.oxlintrc.json`)                                                                                                                    |
| Typecheck               | `pnpm check-types` → per-package **native `tsc`** (`typescript@7`, the Go compiler; replaced `tsgo`). The Next/Payload apps (`site`/`docs`/`cms`) stay on `typescript@6.0.3` JS for the compiler API |
| Format                  | `pnpm format` → `prettier --write "**/*.{ts,tsx,md}"`                                                                                                                                                |
| All tests               | `pnpm turbo test` (Vitest, per package; there is no root `test` script)                                                                                                                              |
| One package, no watch   | `pnpm --dir apps/api test:run`                                                                                                                                                                       |
| **One file + one test** | `pnpm --dir apps/api test:run src/routes/billing/foo.spec.ts -t "test name"`                                                                                                                         |
| Migrations              | `cd packages/db && pnpm db:generate` then `pnpm db:migrate` (drizzle-kit)                                                                                                                            |

- **Regulated test files are `*.spec.ts`** (e.g. `apps/api/vitest.config.ts` →
  `include: ["src/**/*.spec.ts"]`, all of `packages/signing/src/*.spec.ts`).
  Turbo also references `*.test.ts`; prefer `.spec.ts` for api/signing.
- **No JSON/JUnit reporter is configured.** A `/goal` evaluator's only reliable
  signal today is the **process exit code** plus the default summary line. If you
  need machine-parseable output, pass `--reporter=json --outputFile=…` explicitly.

## Architecture map (real paths — "decompose by surface")

- **Data:** `packages/db` (Drizzle/Postgres, `src/schema.ts`, `drizzle/` migrations);
  `packages/local-db` (SQLite offline + outbox).
- **Domain validation / shared:** `packages/schemas` (Zod), `packages/shared`
  (plans/config, `src/finance.ts`, `src/accreditation.ts`).
- **Calibration math:** `packages/math-engine` (parser, evaluator, `uncertainty/`,
  `gum/`, `numeric/`, `audit/`).
- **Signing / documents:** `packages/signing`, `packages/documents`,
  `packages/label-rendering`, `packages/certificate-xlsx-template`,
  `packages/method-definition`, `packages/method-templates`.
- **Auth / access:** `packages/auth` (`access.ts`, `lab-access.ts`, Better-Auth).
- **API:** `apps/api` (Hono — `src/app.ts`, `src/routes/`, `src/modules/`,
  `src/middleware/`, `src/services/`, `src/lib/`); deployed via generated
  `apps/api/api/` Vercel functions.
- **Frontends:** `apps/web` (lab dashboard; thin `src/routes/` adapters +
  `src/features/<domain>/`), `apps/portal` (cloud-only client portal),
  `apps/backoffice`, `apps/cms`, `apps/docs`.
- **Jobs / offline:** `apps/worker` (Vercel Queue + Cron), `services/document-worker`,
  `services/gotenberg`; `apps/desktop` (Electron), `apps/local-server`,
  `packages/sync`.
- **Validation dossiers:** `validation/math-engine/v0.2.4|v0.3.0/dossier.tex`.

## Regulated cut lines (CONFIRMED — the hard boundary for /goal and /loop)

> These classifications govern whether a surface may be touched by an unattended
> loop. **When in doubt, treat a surface as pair-don't-loop.**

| Surface                                                                           | Real location                                                                                                                                                                                                                                                                                                                            | Class                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calibration approval workflow** (separation of duties, "approved is immutable") | `packages/auth/src/access.ts` (`CalibrationState` draft→submitted→in_review→approved→rejected; `calibrationWorkflowPermissions`, `canPerformCalibrationAction`); enforced in `apps/api/src/middleware/permission.ts` (`requireCalibrationAction`); approver columns in `packages/db/src/schema.ts` (`technicalReviewedBy`, `approvedBy`) | **pair-don't-loop**                                                                                                                                   |
| **ICP-Brasil A1 signing / credential custody**                                    | `packages/signing/` (`signer.ts` PKCS#12+PAdES, `chain-validation.ts`, `verify.ts`, `timestamp.ts`, `encryption.ts`); schema `organizationSigningCertificate` (AES-256-GCM encrypted P12 + password)                                                                                                                                     | **pair-don't-loop**                                                                                                                                   |
| **RBAC / multi-tenant policy layer**                                              | `packages/auth/src/access.ts` (Better-Auth `createAccessControl`, roles); enforced in `apps/api/src/middleware/permission.ts` (`requirePermission`, `requireRole`, `requireOrgType`, `requireOrganization`) + `tier-guard.ts` (`requireFeature`, `requirePlanLimit`) + `resolveMemberUnitScope` in `apps/api/src/lib/units.ts`           | **pair-don't-loop**                                                                                                                                   |
| **GUM uncertainty math engine**                                                   | `packages/math-engine` (`gum/`, `uncertainty/type-a.ts`, `type-b.ts`, `numeric/decimal.ts`)                                                                                                                                                                                                                                              | **loopable-with-verifier** — only when gated by the numeric oracle tests **and** a dossier regeneration (`validation/math-engine/v0.3.0/dossier.tex`) |
| **vigência / accreditation capability-vs-validity separation**                    | Not modeled. Today: `organization.accreditationActive` (boolean), `organization.accreditationNumber/Body`, `calibrationMethod.accreditedScope` (boolean) — flags, no validity window                                                                                                                                                     | **doesn't-exist-yet**                                                                                                                                 |
| **PSIE state machine + credential-custody boundary**                              | Not in code. Only `docs/estrategia/precificacao-posicionamento.md` ("lacres/selos Inmetro + PSIE = **não existe no schema**, é a parte que exige construção")                                                                                                                                                                            | **doesn't-exist-yet**                                                                                                                                 |

## Real conventions (detected, not assumed)

- **Migrations are forward-only, tool-generated.** `drizzle-kit generate` emits
  numbered SQL (`packages/db/drizzle/0057_method_template_provenance.sql`) tracked
  in `drizzle/meta/_journal.json`. **Never hand-edit an already-applied migration;
  never renumber.** Schema change → edit `packages/db/src/schema.ts` → `pnpm db:generate`
  → review the SQL → `pnpm db:migrate`.
- **Multi-tenancy = `organizationId` + `unitId` scoping.** `requireOrganization`
  establishes the active org/session; `resolveMemberUnitScope` resolves the unit
  scope; every tenant-scoped query MUST filter by `organizationId` (and `unitId`
  where the table is unit-scoped, e.g. `organizationSigningCertificate`). Never
  return rows across tenants. Preserve tenant/org/unit scoping in every change.
- **Uncertainty is never value-only.** `packages/math-engine` uses an exact
  **decimal backend** (`numeric/decimal.ts`, bigint-based — not float). A
  measurement result carries value **plus** standard/expanded uncertainty, the
  **coverage factor `k`** and (effective) degrees of freedom: `coverageFactor`
  and `expandedUncertainty` are first-class (`uncertainty/type-b.ts`,
  `gum/measurement.ts`); `k` from Student-t via `coverageFactorForProbability(p, νeff)`
  (`gum/statistics.ts`). Results are fingerprinted for audit (`audit/`).
- **Bans:** `useEffect` import from `react` is lint-blocked (use derived state /
  data hooks / `use-mount-effect.ts`); `as` type assertions are banned
  (`consistent-type-assertions: never` — use type guards, `satisfies`, schema parse).
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

- **NBR ISO/IEC 17025** — accreditation standard (`ACCREDITATION_SEAL_SUBTITLE`).
- **Inmetro** — e.g. `"Portaria Inmetro nº 157/2022"` (see `format-specifications.test.ts`).
- **Cgcre** — Coordenação Geral de Acreditação (the Brazilian accreditation body).
- **CGCRE / RBC** — accreditation prefix `CAL`; number stored as digits only
  (`normalizeAccreditationNumber`), displayed `"CAL 0123"` (`formatAccreditationNumber`).
- **MP 2.200-2** + **DOC-ICP-15.03** (perfis PAdES ICP-Brasil: AD-RB/AD-RT/AD-RC/AD-RA) —
  the legal/technical basis for `packages/signing`. ⚠️ Do NOT cite **NIT-DICLA-083**
  for digital signatures: its current revision (Rev.01) is about certified reference
  materials (MRC), unrelated — a long-standing mis-citation corrected in #646
  (pending Cgcre confirmation that no dedicated signature-form NIT exists).
- **OIML R 76** — international recommendation for non-automatic weighing
  instruments (balances). ⚠️ **TODO / assumption:** supplied by the operator;
  **not found referenced anywhere in the codebase today.** Use the exact token
  "OIML R 76"; confirm spelling/edition with a human before putting it on a
  certificate.

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
