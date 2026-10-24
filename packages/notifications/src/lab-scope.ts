import { db, systemDb } from "@calibra-facil/db";
import { forOrg, type OrgDb } from "@calibra-facil/db/for-org";
import {
  calibrationJob,
  calibrationRequest,
  calibrationVisit,
  customer,
  customerGroup,
  member,
  notificationPreference,
  organization,
  portalExportJob,
  user,
} from "@calibra-facil/db/schema";
import type { PortalDigestFrequency } from "@calibra-facil/shared";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Where a notification statement runs (row-level security, P2-18h).
 *
 * A dispatcher starts from the id of an entity the caller just operated on
 * (already authorised and scoped there) or from an explicit laboratory. Every
 * statement after the laboratory is known runs in `inOrg(organization, ...)`:
 * a transaction that names that organization (`calibra.organization_id`), the
 * laboratory's for the entity reads, the RECIPIENT's for the notification rows
 * (a portal user's rows belong to the CLIENT organization of the customer, not
 * to the laboratory). A transaction is short and holds no e-mail send.
 *
 * Global tables (`user`, `organization`, `notification_preference`,
 * `email_suppression`) carry no policy and are read on the plain `db`.
 */
export function inOrg<R>(
  organizationId: string,
  run: (o: OrgDb) => Promise<R>,
): Promise<R> {
  return forOrg(db, organizationId).transaction(run);
}

/**
 * System path (`systemDb`, the owner connection; tenant-sql-allowlist.ts):
 * the entity lookups below learn WHICH laboratory owns the id a caller passed
 * in (a job, a calibration request, a visit, an audit-pack export), before any
 * organization can be named. They return the organization id of that one row
 * and nothing else; the entity itself is then read in `inOrg(laboratory, ...)`.
 */
export async function findJobLaboratory(jobId: number): Promise<string | null> {
  const [row] = await systemDb
    .select({ organizationId: calibrationJob.organizationId })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function findCalibrationRequestLaboratory(
  requestId: number,
): Promise<string | null> {
  const [row] = await systemDb
    .select({ organizationId: calibrationRequest.organizationId })
    .from(calibrationRequest)
    .where(eq(calibrationRequest.id, requestId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function findVisitLaboratory(
  visitId: number,
): Promise<string | null> {
  const [row] = await systemDb
    .select({ organizationId: calibrationVisit.organizationId })
    .from(calibrationVisit)
    .where(eq(calibrationVisit.id, visitId))
    .limit(1);
  return row?.organizationId ?? null;
}

export async function findAuditPackLaboratory(
  exportId: number,
): Promise<string | null> {
  const [row] = await systemDb
    .select({ organizationId: portalExportJob.labOrganizationId })
    .from(portalExportJob)
    .where(eq(portalExportJob.id, exportId))
    .limit(1);
  return row?.organizationId ?? null;
}

/**
 * The portal due-digest cron has no request and no laboratory: it enumerates,
 * across every laboratory, the members of the CLIENT organizations that opted in
 * (`notification_preference`, a per-user global row) and the branch customers
 * each of them aggregates. That enumeration is cross-organization by design and
 * runs on the system path (tenant-sql-allowlist.ts "cron-queue"); it returns
 * ids, addresses and the laboratory of each scope, and the asset reads, the
 * brand and the portal host that follow run in `inOrg(labOrganizationId, ...)`.
 */
export async function listPortalDigestRecipients(
  frequencies: PortalDigestFrequency[],
) {
  const optedInWhere = and(
    eq(organization.type, "CLIENT"),
    eq(member.role, "client_user"),
    inArray(notificationPreference.digestFrequency, frequencies),
    eq(notificationPreference.emailEnabled, true),
  );

  // Members of a branch customer's CLIENT org → one customer each.
  const customerRecipients = await systemDb
    .selectDistinct({
      userId: user.id,
      email: user.email,
      name: user.name,
      frequency: notificationPreference.digestFrequency,
      customerId: customer.id,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .innerJoin(customer, eq(customer.authOrganizationId, organization.id))
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(
      notificationPreference,
      eq(notificationPreference.userId, member.userId),
    )
    .where(optedInWhere);

  // Members of a customer-group's CLIENT org → consolidated over its branches.
  const groupRecipients = await systemDb
    .selectDistinct({
      userId: user.id,
      email: user.email,
      name: user.name,
      frequency: notificationPreference.digestFrequency,
      groupId: customerGroup.id,
      labOrganizationId: customerGroup.labOrganizationId,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .innerJoin(
      customerGroup,
      eq(customerGroup.authOrganizationId, organization.id),
    )
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(
      notificationPreference,
      eq(notificationPreference.userId, member.userId),
    )
    .where(optedInWhere);

  // Resolve each group's branch customer ids in one query.
  const branchesByGroup = new Map<number, number[]>();
  const groupIds = [...new Set(groupRecipients.map((row) => row.groupId))];
  if (groupIds.length > 0) {
    const branches = await systemDb
      .select({ id: customer.id, groupId: customer.groupId })
      .from(customer)
      .where(inArray(customer.groupId, groupIds));
    for (const branch of branches) {
      if (branch.groupId === null) continue;
      const list = branchesByGroup.get(branch.groupId) ?? [];
      list.push(branch.id);
      branchesByGroup.set(branch.groupId, list);
    }
  }

  return { customerRecipients, groupRecipients, branchesByGroup };
}
