import { db } from "@calibra-facil/db";
import { member, personnelCompetence, user } from "@calibra-facil/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { isAssignableTechnician } from "../../lib/tenant-refs";

/**
 * The two questions every command that puts a technician on a job asks: may
 * this person be assigned work in the job's unit, and do they hold an active
 * competence for the instrument type. Shared by `assignJob`, `editJob` and the
 * submit's competence gate so the rule lives once.
 */

/**
 * The technician to assign, or null when they may not be: not a member of the
 * organization (also null for another tenant's user: one generic answer), or
 * an organization member without a technician / unit_admin assignment in the
 * job's unit (org admins and owners need none). `organizationRoles`, when
 * given, additionally restricts the member's organization role.
 */
export async function findAssignableTechnician(params: {
  organizationId: string;
  userId: string;
  unitId: number | null;
  organizationRoles?: readonly string[];
}): Promise<{ userId: string; name: string } | null> {
  if (
    !(await isAssignableTechnician({
      organizationId: params.organizationId,
      userId: params.userId,
      unitId: params.unitId,
    }))
  ) {
    return null;
  }

  const [found] = await db
    .select({ userId: member.userId, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.userId, params.userId),
        eq(member.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!found) return null;
  if (
    params.organizationRoles &&
    !params.organizationRoles.includes(found.role)
  ) {
    return null;
  }
  return { userId: found.userId, name: found.name };
}

/**
 * Is the technician authorized for this instrument type (ISO/IEC 17025
 * §6.2.5)? Auto-detected like the assignment gate: it only applies once the
 * organization keeps competence records at all. A competence is judged on
 * `performedAt`: the day the work was performed for a submit, now for an
 * assignment.
 */
export async function technicianHasCompetence(params: {
  organizationId: string;
  technicianId: string | null;
  assetTypeId: number;
  performedAt: Date;
}): Promise<boolean> {
  if (!params.technicianId) return true;

  const [competenceCount] = await db
    .select({ total: count() })
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.organizationId, params.organizationId),
        isNull(personnelCompetence.deletedAt),
      ),
    );
  if ((competenceCount?.total ?? 0) === 0) return true;

  const [active] = await db
    .select({
      id: personnelCompetence.id,
      expiresAt: personnelCompetence.expiresAt,
    })
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.userId, params.technicianId),
        eq(personnelCompetence.organizationId, params.organizationId),
        eq(personnelCompetence.assetTypeId, params.assetTypeId),
        eq(personnelCompetence.status, "ACTIVE"),
        isNull(personnelCompetence.deletedAt),
      ),
    )
    .limit(1);

  if (!active) return false;
  return !active.expiresAt || active.expiresAt >= params.performedAt;
}
