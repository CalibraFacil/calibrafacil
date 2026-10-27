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
    kinds: ["select"],
    reason:
      "System path (P2-18h): API-key authentication looks the key up by its hash (systemDb), because the hash IS the credential and the row yields the laboratory. Everything after it, the last-used touch included, runs in orgDb(key.organizationId).transaction.",
  },
  {
    category: "auth-session",
    file: "apps/api/src/lib/identity.ts",
    tables: ["member"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, systemDb): the magic-link preview (findUserPrimaryOrganization) resolves the signing-in user's own lab memberships by user_id, before an active organization exists; it returns only the organization's public name and logo.",
  },
  {
    category: "auth-session",
    file: "apps/api/src/lib/public-signup-store.ts",
    tables: ["member"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, systemDb): public self-serve sign-up (hasLabMembership) asks whether the e-mail's user already belongs to ANY laboratory before one is provisioned; an unauthenticated visitor has no organization. One row, only its existence is used.",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/auth.ts",
    tables: ["personnel_competence", "training_record", "authorized_signatory"],
    reason:
      "System path (P2-18j, getSystemDb): Better Auth deleteUser preserves the regulated records of the user being deleted across every organization they belonged to (by user_id, then by the rows' own ids), in ONE transaction so the preservation and its audit rows land together; no single organization can be named.",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/lab-access.ts",
    tables: ["member", "invitation"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, getSystemDb): sign-in gate: does this e-mail belong to a laboratory (not soft-deleted) or hold a pending invitation to one? Resolved by e-mail before any organization is active.",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/auth.ts",
    tables: ["member"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, getSystemDb): session creation picks the user's default active organization (oldest non-deleted membership of the surface) by user_id, and the portal sign-in link checks the e-mail's own client memberships, both before an organization is active.",
  },
  {
    category: "auth-session",
    file: "packages/auth/src/auth.ts",
    tables: ["invitation", "customer", "organization_custom_domain"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, getSystemDb): the portal magic-link sender finds the pending invitation of an e-mail (or by the invite id, the bearer secret) and the laboratory whose customer a CLIENT organization is (customer.auth_organization_id, for the e-mail brand); the CORS origin check asks whether a hostname is an active verified portal domain of ANY laboratory. All before an organization is known, one row each.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/records-purge.ts",
    tables: ["customer"],
    kinds: ["delete"],
    sql: /delete from organization o where o\.id = \$1 and o\.type = '[^']*' and not exists \( select 1 from customer c where c\.auth_organization_id = o\.id\)/,
    reason:
      "Records purge (system path, systemDb, P2-18j): after a laboratory is erased, its portal-login CLIENT organizations are removed in the same transaction unless another customer still points at them (a cross-tenant existence check on customer.auth_organization_id, which no single laboratory can answer).",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/sync-change-log-purge.ts",
    tables: ["sync_change_log"],
    kinds: ["select"],
    sql: /select distinct organization_id from sync_change_log/i,
    reason:
      "System path (P2-18j, systemDb): the change-log retention cron lists which laboratories hold entries older than the window (organization ids only); the delete and the purge horizon of each laboratory then run in orgTransactionWithExecutor(laboratory) with an explicit organization_id predicate.",
  },
  // -------------------------------------------------------------------------
  // public-token: the unguessable token/secret is the credential; the
  // organization comes from the row the token resolves to.
  // -------------------------------------------------------------------------
  {
    category: "public-token",
    file: "apps/api/src/modules/service-orders/service-order.tokens.ts",
    tables: ["service_order_public_access_token"],
    kinds: ["select"],
    reason:
      "System path (P2-18g): the grant of a public quote link is looked up by its unguessable token_hash / code_hash alone (systemDb) because the grant row is what names the laboratory. Every statement after it (order, quote, token writes, events) runs in orgDb(grant.organizationId).transaction.",
  },
  {
    category: "public-token",
    file: "apps/api/src/lib/public-certificate-verification.ts",
    tables: [
      "calibration_job",
      "asset",
      "calibration_method",
      "customer",
      "service",
      "issued_certificate_snapshot",
      // The seal decision frozen at approval (`certificate_input.seal`), joined
      // on the job AND its organization; only the `seal` key is selected.
      "certificate_input",
    ],
    kinds: ["select"],
    reason:
      "Public certificate verification (routes/verify.ts, on the system path): looked up by verification_token, which names the laboratory; the amendment links that follow are bound to it (orgDb). Exposes only that certificate.",
  },
  {
    category: "public-token",
    file: "apps/api/src/lib/oot-acknowledgement.ts",
    tables: ["oot_notification", "non_conformance"],
    kinds: ["select"],
    reason:
      "Public out-of-tolerance acknowledgement link (routes/oot-ack.ts, on the system path): looked up by the unguessable ack_token from the e-mailed link, which names the laboratory; the stamp that follows runs in orgDb(laboratory).transaction. Exposes only that notification's NC number and laboratory name.",
  },
  {
    category: "public-token",
    file: "apps/api/src/lib/identity.ts",
    tables: ["invitation"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, systemDb): public invite preview / setup-link request (findPublicInvitation, findLabInvitationForSetupLink): the invitation id is the bearer secret and its own row names the organization.",
  },
  {
    category: "public-token",
    file: "packages/auth/src/lab-access.ts",
    tables: ["lab_account_setup_token"],
    kinds: ["select", "update"],
    reason:
      "System path (P2-18j, getSystemDb): setup-token lookup by id (and the single-use consume by id) while the token's own row is what names the laboratory; the membership and invitation checks that follow run in forOrg(laboratory).transaction.",
  },
  // -------------------------------------------------------------------------
  // cron-queue: runs across all tenants by design.
  // -------------------------------------------------------------------------
  {
    category: "cron-queue",
    file: "packages/jobs-core/src/email-domain-health.ts",
    tables: ["organization_email_domain"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, systemDb): the sender-domain health cron has no request, so one statement lists every laboratory's sending domain; each row's update and its audit events are written after the Resend call in forOrg(application, row.organizationId).transaction.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/org-transaction.ts",
    tables: ["sync_change_log", "sync_change_log_purge"],
    kinds: ["insert"],
    sql: /insert into sync_change_log_purge/,
    reason:
      "Change-log retention (P2-18j): the per-laboratory purge runs in orgTransactionWithExecutor(laboratory); one statement deletes that laboratory's old entries (organization_id = $1) and records its purge horizon from the deleted rows' own organization_id, which a statement-level analysis cannot see through the CTE.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/services/lab-provisioning.ts",
    tables: ["member"],
    kinds: ["select"],
    sql: /from "member" where "member"\."user_id" = \$1 limit/,
    reason:
      "System path (P2-18j): provisioning calls Better Auth's createOrganization, whose organization plugin reads the creator's memberships by user_id (organization limit check) on the identity adapter (getSystemDb). Only reached with the real Better Auth (the identity-lab-scope spec); the other specs fake it.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/certificate-drift.ts",
    tables: ["issued_certificate_snapshot"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, systemDb): the certificate drift sweep lists the newest snapshots of every tenant to re-hash their stored PDFs (platform integrity job, not request-scoped); the audit event of a finding is written in orgDb(snapshot.organizationId).transaction.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/audit-chain.ts",
    tables: ["job_audit_log"],
    kinds: ["select"],
    reason:
      "System path (roadmap 2 B1, systemDb): the audit-chain verifier lists which laboratories hold audit rows (one EXISTS per organization row) to recompute each one's hash chain (platform integrity job, not request-scoped, like the certificate drift sweep). The chain itself is read through calibra_audit_chain_verify(table, organization), which names the laboratory; its findings are written in orgDb(organizationId).transaction.",
  },
  {
    category: "cron-queue",
    file: "packages/db/src/queue-render-recovery.ts",
    tables: ["calibration_job"],
    kinds: ["select"],
    sql: /from calibration_job cj where cj\.status = ''.* and not exists \( select 1 from app_queue_job q where /,
    reason:
      "queue-backstop stuck-render sweep (system path, systemDb): finds GENERATING_PDF certificates older than STUCK_RENDER_AFTER_MS with no live queue row across every tenant; each rejection then runs in forOrg(db, candidate.organization_id).transaction.",
  },
  {
    category: "cron-queue",
    file: "packages/jobs-core/src/spc-recompute.ts",
    tables: ["control_chart"],
    kinds: ["select"],
    sql: /select distinct "organization_id" from "control_chart"/,
    reason:
      "SPC nightly sweep (system path): the cron has no request to name a laboratory, so one statement lists which laboratories own a control chart; every chart is then read, evaluated and written in forOrg(db, lab).transaction.",
  },
  {
    category: "cron-queue",
    file: "packages/db/src/queue-render-recovery.ts",
    tables: ["calibration_job"],
    kinds: ["select"],
    sql: /from "calibration_job" where "calibration_job"\."id" = \$\d+ limit/,
    reason:
      "queue-backstop dead-letter handling (system path, systemDb): the app_queue_job payload carries only the job id, so the owning organization is read from the job itself; the rejection then runs in forOrg(db, that organization).transaction.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/modules/integrations/active-connections.ts",
    tables: ["organization_integration", "integration_connection"],
    kinds: ["select"],
    reason:
      "System path (P2-18h): the Conta Azul cron sweeps (scheduled sync, payment / payable / fiscal / protocol / drift / stock polling) have no request, so one statement lists which laboratories hold an active Conta Azul connection (ids and the non-secret config). Every run, event, link and cursor after it is written in orgDb(row.organizationId).transaction.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/approval-effects-reconciler.ts",
    tables: ["calibration_job", "asset_oot_event"],
    kinds: ["select"],
    sql: /from "calibration_job" where .*not exists \(select 1 from "asset_oot_event"/,
    reason:
      "System path (roadmap 2 B2, systemDb): the nightly approval-effects reconciler lists, across EVERY laboratory (cron, no request), the approved NON_CONFORMING jobs that have no out-of-tolerance event (ids only, and a count of the ones older than its window). Each job is then repaired in orgTransactionWithExecutor(job.organizationId), which re-reads it under row-level security before writing.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/approval-effects-reconciler.ts",
    tables: ["calibration_job", "asset"],
    kinds: ["select"],
    sql: /from "calibration_job" inner join "asset"/,
    reason:
      "System path (roadmap 2 B2, systemDb): the approval-effects reconciler lists, across every laboratory, the approved jobs whose asset's last calibration date is older than the job's own (ids only). Each advance runs in orgTransactionWithExecutor(job.organizationId).",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/approval-effects-reconciler.ts",
    tables: ["asset_oot_event", "calibration_job", "asset_oot_audit_log"],
    kinds: ["select"],
    sql: /from "asset_oot_event" inner join "calibration_job"/,
    reason:
      "System path (roadmap 2 B2, systemDb): the approval-effects reconciler lists, across every laboratory, the out-of-tolerance events whose customer alert never left (no `notify` audit entry, no live queue job): event id, its laboratory and the approver. The alert is staged in orgTransactionWithExecutor(event.labOrganizationId).",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/oot-email-drain.ts",
    tables: ["oot_email_outbox"],
    kinds: ["select"],
    sql: /from "oot_email_outbox" where/,
    reason:
      "System path (P2-18h): the section 7.10 e-mail drain lists the owed outbox rows of EVERY laboratory in one statement (cron, no request); each row is then claimed, read and finished in a transaction that names row.organizationId.",
  },
  {
    category: "cron-queue",
    file: "apps/api/src/lib/service-order-email-drain.ts",
    tables: ["service_order_email_outbox"],
    kinds: ["select"],
    sql: /from "service_order_email_outbox" where/,
    reason:
      "System path (P2-18h): the service-order e-mail drain lists the owed outbox rows of EVERY laboratory in one statement (cron, no request); each row is then claimed, read and finished in a transaction that names row.organizationId.",
  },
  {
    category: "cron-queue",
    file: "packages/notifications/src/lab-scope.ts",
    tables: ["member", "customer", "customer_group"],
    kinds: ["select"],
    reason:
      "System path (P2-18h): the portal due-digest cron has no laboratory; it enumerates, across every laboratory, the members of the CLIENT organizations that opted in (notification_preference is a per-user global row) and each scope's branch customers. The asset reads, the brand and the portal host that follow run in inOrg(labOrganizationId).",
  },
  {
    category: "pk-after-scoped-read",
    file: "packages/notifications/src/lab-scope.ts",
    tables: [
      "calibration_job",
      "calibration_request",
      "calibration_visit",
      "portal_export_job",
    ],
    kinds: ["select"],
    sql: /^select "(?:lab_)?organization_id" from "[a-z_]+" where "[a-z_]+"\."id" = \$1 limit \$2$/,
    reason:
      "System path (P2-18h): a notification sender is called with the id of the entity the caller just operated on (already authorised and scoped there); this one-column lookup learns the laboratory of that id. The entity itself, the recipients and the notification rows are then read and written in inOrg(laboratory / recipient organization).",
  },
  // -------------------------------------------------------------------------
  // portal-cross-org: the portal's data statements all run through the
  // org-bound handle (forOrg / forOrgs, packages/db/src/for-org.ts), so they
  // carry the organization predicate and need no entry. What stays is the
  // lookup that LEARNS the laboratory (or the set of laboratories) of a portal
  // session, which cannot be bound to one yet: it starts from the signed-in
  // user or from the CLIENT organization, both of which are outside any
  // laboratory.
  // -------------------------------------------------------------------------
  {
    category: "portal-cross-org",
    file: "apps/api/src/lib/portal-customer-scope.ts",
    tables: ["member", "customer"],
    kinds: ["select"],
    reason:
      "Resolves WHICH customers (and therefore which laboratory) a portal session belongs to: the user's CLIENT memberships by user_id, a group's branches by group_id. It produces the laboratory every other portal statement is then bound to.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/lib/portal-customer-scope.ts",
    tables: ["member", "customer", "customer_group"],
    kinds: ["select"],
    sql: /left join "customer_group" on/,
    reason:
      "GET /organizations (the portal's organization switcher): the signed-in user's own CLIENT memberships by member.user_id. A person belongs to organizations of several laboratories, so this is cross-organization by design; it is the only portal endpoint that lists across laboratories on purpose.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/lib/portal-domains.ts",
    tables: ["organization_custom_domain"],
    kinds: ["select"],
    reason:
      "System path: the host name of a portal request is what LEARNS the laboratory (white-label domain), and a hostname is unique across the platform, so both the host lookup and the 'does another laboratory hold this hostname' check are cross-organization by design.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/lib/portal-domains.ts",
    tables: ["customer"],
    kinds: ["select"],
    reason:
      "System path: maps a CLIENT organization (customer.auth_organization_id) to the laboratory it belongs to, to build the portal link of an invitation; it runs before a laboratory can be named.",
  },
  {
    category: "portal-cross-org",
    file: "apps/api/src/modules/service-orders/service-order.list-queries.ts",
    tables: ["customer"],
    kinds: ["select"],
    sql: /from "customer" where .*"auth_organization_id" = \$\d+/,
    reason:
      "getPortalCustomerForAuthOrganization: the portal service-order scope resolver. It maps the session's CLIENT organization (customer.auth_organization_id) to its customer and therefore to the laboratory every following portal service-order statement is bound to (forOrg), like portal-customer-scope.ts for the other portal routes.",
  },
  {
    category: "other",
    file: "apps/api/src/modules/sync/desktop-customer-org.ts",
    tables: ["customer"],
    kinds: ["select"],
    sql: /from "customer" where .*"auth_organization_id" = \$\d+ and .*"lab_organization_id" <> \$\d+/,
    reason:
      "System path (P2-18i): the desktop-sync create_local_customer pre-phase asks whether any OTHER laboratory's customer is attached to the CLIENT organization it found by slug before adopting it (one id column, read only). A session bound to one laboratory can never see another laboratory's row, so the question is cross-laboratory by design and runs on systemDb; everything else of the push runs in the event's transaction naming the pushing device's laboratory.",
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
    file: "apps/api/src/lib/org-transaction.ts",
    tables: ["asset", "customer", "job_commercial_snapshot"],
    kinds: ["select"],
    reason:
      "orgTransactionWithExecutor hands its raw, organization-named transaction to persistCalibrationJob (request->job conversion, visit POST /:id/jobs): see the lib/jobs.ts entry. Every other statement of those handlers goes through the org-bound handle, which carries the predicate.",
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
    category: "other",
    file: "apps/api/src/lib/email-domains.ts",
    tables: ["organization_email_domain"],
    kinds: ["select"],
    reason:
      "System path (P2-18j, systemDb): a sending hostname is unique across the platform, so 'does ANOTHER laboratory hold it' (otherOrganizationHoldsHostname, run before a domain is created) is cross-organization by design. One row, only its existence is used.",
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
    category: "provisioning",
    file: "apps/api/src/cli/seed-demo/history-rewrite.ts",
    tables: ["job_audit_log", "job_standard", "asset_audit_log"],
    kinds: ["select", "update"],
    reason:
      "Demo seed only: back-dates the audit rows and standards links of the jobs/assets it just created, by their entity id, inside the calibra.allow_audit_rewrite transaction (these tables gained organization_id in migration 0118). No route reaches it.",
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
