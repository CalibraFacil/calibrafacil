// Entity reads and recipient lookups the recipes share.
import {
  asset,
  calibrationJob,
  customer,
  member,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { labDaysUntil } from "@calibra-facil/shared";
import { getRecipientsByRole } from "../delivery";
import { findJobLaboratory, inOrg } from "../lab-scope";

/**
 * Get job details for notification context
 */
export async function getJobDetails(jobId: number): Promise<{
  jobIdentifier: string;
  organizationId: string;
  technicianId: string | null;
  customerId: number;
  assetId: number;
  createdBy: string;
} | null> {
  const laboratoryId = await findJobLaboratory(jobId);
  if (!laboratoryId) return null;

  const [job] = await inOrg(laboratoryId, (o) =>
    o
      .select({
        jobIdentifier: calibrationJob.jobId,
        organizationId: calibrationJob.organizationId,
        technicianId: calibrationJob.technicianId,
        customerId: calibrationJob.customerId,
        assetId: calibrationJob.assetId,
        createdBy: calibrationJob.createdBy,
      })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, jobId))
      .limit(1),
  );

  return job ?? null;
}

/**
 * Get asset details for notification context
 */
export async function getAssetDetails(
  organizationId: string,
  assetId: number,
): Promise<{
  name: string;
  tag: string;
  manufacturer: string | null;
  model: string | null;
} | null> {
  const [assetData] = await inOrg(organizationId, (o) =>
    o
      .select({
        name: asset.name,
        tag: asset.tag,
        manufacturer: asset.manufacturer,
        model: asset.model,
      })
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1),
  );

  return assetData ?? null;
}

/** A user's display name, or `fallback` when the user is gone. */
export async function getUserName(
  userId: string,
  fallback: string,
): Promise<string> {
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return row?.name ?? fallback;
}

/** The lab members who run the laboratory: the usual audience of a compliance alert. */
export function adminsAndOwners(organizationId: string): Promise<string[]> {
  return getRecipientsByRole(organizationId, ["admin", "owner"]);
}

/** Every member of an organization (a portal customer's CLIENT organization, for instance). */
export async function listMemberIds(organizationId: string): Promise<string[]> {
  const members = await inOrg(organizationId, (o) =>
    o
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
  );
  return members.map((m) => m.userId);
}

/** The portal organization and name of a customer of `laboratoryId`, when it has a portal. */
export async function getCustomerPortalContact(
  laboratoryId: string,
  customerId: number,
): Promise<{ authOrganizationId: string | null; name: string } | undefined> {
  const [row] = await inOrg(laboratoryId, (o) =>
    o
      .select({
        authOrganizationId: customer.authOrganizationId,
        name: customer.name,
      })
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1),
  );
  return row;
}

/**
 * Calculate whole laboratory days remaining until a calendar date (0 on the
 * day itself, negative once past).
 */
export function getDaysRemaining(dueDate: Date): number {
  return labDaysUntil(dueDate, new Date());
}
