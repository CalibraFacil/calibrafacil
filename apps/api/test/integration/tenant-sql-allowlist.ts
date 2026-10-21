import type { StatementKind } from "./tenant-sql-analyzer";

// Legitimate unscoped access to a tenant-scoped table, one entry per
// (file, table) pair, each with a reason. Everything the tenant SQL guard
// flags that is NOT listed here fails the integration test that issued it.
//
// Matching: an entry covers a finding when `file` is a suffix of the path of
// the application file that issued the statement (repo-relative, e.g.
// "apps/api/src/routes/portal.ts"), every table of the finding is in `tables`,
// `kinds` (if given) contains the statement kind, and `sql` (if given) matches
// the normalized statement. Prefer narrow entries: name the table and, when the
// file mixes scoped and unscoped statements, a `sql` pattern.
//
// Do NOT allowlist a statement just to silence it: if request-scoped data can
// be reached by an id from another tenant, add the organization predicate.

export type AllowCategory =
  | "auth-session"
  | "public-token"
  | "cron-queue"
  | "portal-cross-org"
  | "pk-after-scoped-read"
  | "unit-scoped"
  | "global-catalog"
  | "provisioning"
  | "other";

export type AllowEntry = {
  category: AllowCategory;
  file: string;
  tables: readonly string[];
  kinds?: readonly StatementKind[];
  sql?: RegExp;
  reason: string;
};

export const TENANT_SQL_ALLOWLIST: readonly AllowEntry[] = [
  // -------------------------------------------------------------------------
  // auth-session: identity is established BEFORE any organization is known.
  // -------------------------------------------------------------------------
  {
    category: "auth-session",
    file: "apps/api/src/middleware/api-key-auth.ts",
    tables: ["organization_api_key"],
    reason:
      "API-key authentication: the key hash IS the lookup and yields the organization (and then a last-used touch by the row's own id).",
  },
  {
    category: "auth-session",
    file: "apps/api/src/routes/magic-link.ts",
    tables: ["member"],
    kinds: ["select"],
    reason:
      "Magic-link preview resolves the signing-in user's own lab memberships by user_id, before an active organization exists.",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/auth.ts",
    tables: ["personnel_competence", "training_record", "authorized_signatory"],
    reason:
      "Better Auth deleteUser: preserves the regulated records of the user being deleted across every organization they belonged to (by user_id, then by the rows' own ids).",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/lab-access.ts",
    tables: ["member", "invitation"],
    kinds: ["select"],
    reason:
      "Sign-in gate: does this e-mail belong to a laboratory (not soft-deleted) or hold a pending invitation to one? Resolved by e-mail before any organization is active.",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/auth.ts",
    tables: ["member"],
    kinds: ["select"],
    reason:
      "Session creation picks the user's default active organization (oldest non-deleted membership of the surface) by user_id, before one is active.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/records-purge.ts",
    tables: ["customer"],
    kinds: ["delete"],
    sql: /delete from organization o where o\.id = \$1 and o\.type = '[^']*' and not exists \( select 1 from customer c where c\.auth_organization_id = o\.id\)/,
    reason:
      "Records purge: after a laboratory is erased, its portal-login CLIENT organizations are removed unless another customer still points at them (a cross-tenant existence check on customer.auth_organization_id).",
  },
  // -------------------------------------------------------------------------
  // public-token: the unguessable token/secret is the credential; the
  // organization comes from the row the token resolves to.
  // -------------------------------------------------------------------------
  {
    category: "public-token",
    file: "apps/api/src/modules/service-orders/service-order.tokens.ts",
    tables: ["service_order", "service_order_public_access_token"],
    reason:
      "Public quote-access tokens/approval codes: lookup by token_hash/code_hash, then the order and token rows reached from that token by id.",
  },
  {
    category: "public-token",
    file: "apps/api/src/routes/verify.ts",
    tables: [
      "calibration_job",
      "asset",
      "calibration_method",
      "customer",
      "service",
    ],
    kinds: ["select"],
    reason:
      "Public certificate verification: looked up by verification_token (or by the supersedes link of a job already resolved from a token); exposes only that certificate.",
  },
  {
    category: "public-token",
    file: "apps/api/src/routes/invitations.ts",
    tables: ["invitation"],
    kinds: ["select"],
    reason:
      "Public invite preview/setup: the invitation id is the bearer secret and its own row names the organization.",
  },
  {
    category: "public-token",
    file: "apps/api/src/routes/lab-setup.ts",
    tables: ["lab_account_setup_token"],
    kinds: ["update"],
    reason:
      "Setup-token consumption by the token's own id after the secret hash matched (single-use guard in the WHERE).",
  },
  {
    category: "public-token",
    file: "packages/auth/src/lab-access.ts",
    tables: ["lab_account_setup_token"],
    kinds: ["select"],
    reason: "Setup-token lookup by id after the token secret was verified.",
  },
  // -------------------------------------------------------------------------
  // cron-queue: runs across all tenants by design.
  // -------------------------------------------------------------------------
  {
    category: "cron-queue",
    file: "apps/api/src/lib/certificate-drift.ts",
    tables: ["issued_certificate_snapshot"],
    kinds: ["select"],
    reason:
      "Certificate drift sweep re-hashes stored PDFs for every tenant (platform integrity job, not request-scoped).",
  },
  {
    category: "cron-queue",
    file: "packages/db/src/queue-render-recovery.ts",
    tables: ["calibration_job"],
    kinds: ["select"],
    sql: /from calibration_job cj where cj\.status = ''.* and not exists \( select 1 from app_queue_job q where /,
    reason:
      "queue-backstop stuck-render sweep: finds GENERATING_PDF certificates older than STUCK_RENDER_AFTER_MS with no live queue row across every tenant; each rejection then runs scoped by the candidate's own organization_id.",
  },
  {
    category: "cron-queue",
    file: "packages/db/src/queue-render-recovery.ts",
    tables: ["calibration_job"],
    kinds: ["select"],
    sql: /from "calibration_job" where "calibration_job"\."id" = \$\d+ limit/,
    reason:
      "queue-backstop dead-letter handling: the app_queue_job payload carries only the job id, so the owning organization is read from the job itself and every following write is scoped by it.",
  },
  // -------------------------------------------------------------------------
  // portal-cross-org: the client portal reads across laboratories; its tenant
  // boundary is the customer (portal customer scope), not organization_id.
  // -------------------------------------------------------------------------
  {
    category: "portal-cross-org",
    file: "apps/api/src/lib/portal-customer-scope.ts",
    tables: ["member", "customer"],
    kinds: ["select"],
    reason:
      "Resolves WHICH customers a portal session may see (memberships by user_id, group branches by group_id); it produces the scope the other portal queries filter by.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/lib/portal-certificate-release-gate.ts",
    tables: ["certificate_release"],
    kinds: ["select"],
    reason:
      "Release state for job ids that a customer-scoped portal query already returned.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/routes/portal.ts",
    tables: [
      "asset",
      "asset_oot_event",
      "calibration_job",
      "calibration_method",
      "calibration_request",
      "customer",
      "service",
      "service_order",
    ],
    sql: /"customer_id" (?:in|=) |customer_id in /,
    reason:
      "Client portal: every statement is filtered by the session's in-scope customer ids (customer_id IN (...)); the portal spans laboratories so organization_id is not the boundary.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/routes/portal.ts",
    tables: ["asset"],
    kinds: ["select"],
    sql: /where \("asset"\."id" = \$\d+ and "asset"\."deleted_at" is null\) limit/,
    reason:
      "PUT /assets/:id/interval loads the asset by id, then decidePortalIntervalWrite answers an identical 404 unless its customer is in scope; the UPDATE repeats the customer_id IN (...) predicate.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/routes/portal-requests.ts",
    tables: [
      "asset",
      "calibration_job",
      "calibration_request",
      "customer",
      "service",
    ],
    kinds: ["select"],
    reason:
      "Portal requests: customer_id IN (session scope) on the request, then its items/assets/jobs by the request ids just returned.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/routes/portal-visits.ts",
    tables: [
      "calibration_job",
      "calibration_visit",
      "customer",
      "visit_reschedule_request",
    ],
    reason:
      "Portal visits: customer_id IN (session scope) on the visit, then children / the confirm UPDATE by the visit id that scoped read returned.",
  },
  // -------------------------------------------------------------------------
  // ownership-checked-in-code: the row is read by id and its organization is
  // compared in application code before anything is used or written; another
  // tenant's row answers exactly like a missing one.
  // -------------------------------------------------------------------------
  {
    category: "ownership-checked-in-code",
    file: "apps/api/src/lib/jobs.ts",
    tables: ["asset", "customer", "job_commercial_snapshot"],
    kinds: ["select"],
    reason:
      "persistCalibrationJob: asset read by id, then customer.lab_organization_id !== organizationId -> 'Ativo nao encontrado' (REQ-TENANT-JOB-001); the commercial snapshot is read for the job id just created.",
  },
  {
    category: "ownership-checked-in-code",
    file: "apps/api/src/routes/jobs.ts",
    tables: ["asset", "customer"],
    kinds: ["select"],
    reason:
      "POST / opens the transaction that runs persistCalibrationJob (see lib/jobs.ts entry).",
  },
  {
    category: "ownership-checked-in-code",
    file: "apps/api/src/routes/calibration-requests.ts",
    tables: [
      "asset",
      "customer",
      "calibration_job",
      "service",
      "job_commercial_snapshot",
    ],
    kinds: ["select"],
    reason:
      "Request->job conversion runs persistCalibrationJob (see lib/jobs.ts entry); the item/asset listing is keyed by request ids a scoped read returned.",
  },
  {
    category: "ownership-checked-in-code",
    file: "apps/api/src/modules/service-orders/service-order.commands.ts",
    tables: ["asset", "customer"],
    kinds: ["select"],
    reason:
      "createServiceOrder: asset read by id, then labOrganizationId !== member.organizationId -> invalid_asset.",
  },
  {
    category: "ownership-checked-in-code",
    file: "apps/api/src/modules/service-orders/service-order.certificates.ts",
    tables: ["service_order"],
    kinds: ["select"],
    reason:
      "unlinkServiceOrderCertificate: order read by id, then order.organizationId !== organizationId -> not_found, BEFORE the link DELETE (SEC-01).",
  },
  {
    category: "ownership-checked-in-code",
    file: "apps/api/src/modules/service-orders/service-order.quotes.ts",
    tables: ["service_order"],
    reason:
      "Portal-user quote approval: order read by id, then order.customerId must equal the session's linked customer (else not_found); the UPDATEs address that same order id.",
  },
  // -------------------------------------------------------------------------
  // unit-scoped
  // -------------------------------------------------------------------------
  {
    category: "unit-scoped",
    file: "apps/api/src/routes/assets.ts",
    tables: ["asset", "customer"],
    kinds: ["select"],
    sql: /"asset"\."unit_id" (?:=|in) /,
    reason:
      "Asset listing is scoped by unit_id from resolveMemberUnitScope (the member's organization-bound unit ids); organization_id is implied by the unit.",
  },
  // -------------------------------------------------------------------------
  // pk-after-scoped-read: the id comes from a row an organization-scoped
  // statement in the same handler just returned (the guard proves the cases
  // where the id was a bound parameter; these are the ones where it was a
  // column value read from a result row, which a statement log cannot see).
  // -------------------------------------------------------------------------
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/lib/asset-calibration-advance.ts",
    tables: ["asset"],
    reason:
      "assetId comes from the job being approved/published, which the caller has already loaded and authorized.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/lib/certificate-release.ts",
    tables: ["certificate_release", "service"],
    reason:
      "recomputeCertificateRelease: serviceId / release id read from the job and release rows of the job the caller scoped (finance route scopes the job by organization + unit first).",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/routes/finance/certificate-release.ts",
    tables: ["certificate_release_policy"],
    kinds: ["select"],
    reason:
      "Applied policy fetched by the appliedPolicyId stored on the (scoped) release row.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/lib/email-domain-lifecycle.ts",
    tables: ["organization_email_domain"],
    reason:
      "Row loaded by organization_id under the tenant lock in the same transaction, then updated/deleted by its own id.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/routes/email-domains.ts",
    tables: ["organization_email_domain"],
    kinds: ["update"],
    reason:
      "Record loaded via getOrganizationEmailDomain(member.organizationId), then updated by record.id.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/lib/integrations.ts",
    tables: [
      "integration_event_log",
      "integration_object_link",
      "integration_sync_run",
    ],
    kinds: ["select"],
    reason:
      "Overview/coverage reads keyed by integration_id of the organization-scoped connection record passed in.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/lib/service-order-workflow.ts",
    tables: ["organization_unit", "billing_document"],
    reason:
      "Unit read by the (scoped) order's unitId; billing document numbered by the id just inserted in the same transaction.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/modules/service-orders/service-order.list-queries.ts",
    tables: ["service_order_public_access_token"],
    kinds: ["select"],
    reason:
      "Tokens of a quote id taken from the organization-scoped order list.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/routes/visits.ts",
    tables: ["calibration_job", "visit_reschedule_request"],
    kinds: ["select"],
    reason:
      "Per-visit aggregates keyed by the visit ids of the organization/unit-scoped visit list just fetched.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/routes/proficiency-tests.ts",
    tables: ["pt_plan_item"],
    kinds: ["update"],
    reason:
      "Plan item loaded by (organization_id, scope_part) in the same handler, then updated by planItem.id.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/routes/spc.ts",
    tables: ["control_chart"],
    kinds: ["update"],
    reason:
      "evaluateAndPersist receives a chart row already loaded through an organization-scoped query and persists it by chart.id.",
  },
  {
    category: "pk-after-scoped-read",
    file: "apps/api/src/routes/standards.ts",
    tables: ["reference_standard_certificate_document"],
    kinds: ["select"],
    reason: "Current certificates of the standard ids of the scoped list.",
  },
  {
    category: "pk-after-scoped-read",
    file: "packages/notifications/src/service.ts",
    tables: [
      "asset",
      "calibration_job",
      "calibration_request",
      "calibration_visit",
      "customer",
    ],
    kinds: ["select"],
    reason:
      "Notification context loaders: callers pass the id of the entity they just operated on after their own scoped lookup; the recipients' organization is derived from the loaded row itself.",
  },
  {
    category: "provisioning",
    file: "apps/api/src/cli/seed-demo/history-rewrite.ts",
    tables: [
      "calibration_job",
      "job_commercial_snapshot",
      "issued_certificate_snapshot",
    ],
    kinds: ["update"],
    reason:
      "Demo seed only: back-dates the jobs it just created, by id, inside the calibra.allow_audit_rewrite transaction. No route reaches it.",
  },
];
