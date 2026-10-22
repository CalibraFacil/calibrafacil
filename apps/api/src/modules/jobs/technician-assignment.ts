import { db } from "@calibra-facil/db";
import {
  member,
  personnelCompetence,
  service,
  user,
} from "@calibra-facil/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { invalid } from "../../lib/domain-errors";
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
 * job's unit (org admins and owners need none). Decision Q25: this is the ONE
 * rule, for `assignJob` and `editJob` alike.
 */
export async function findAssignableTechnician(params: {
  organizationId: string;
  userId: string;
  unitId: number | null;
}): Promise<{ userId: string; name: string } | null> {
  if (!(await isAssignableTechnician(params))) return null;

  const [found] = await db
    .select({ userId: member.userId, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.userId, params.userId),
        eq(member.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  return found ?? null;
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

/**
 * The competence gate of putting a technician on a job (ISO/IEC 17025 §6.2.5,
 * decision Q26): shared by `assignJob` and `editJob`, so every way of naming a
 * technician asks the same question. The instrument type is the job's
 * service's; a service without one has nothing to check. Like the submit's
 * gate it applies once the organization keeps competence records at all, and
 * an assignment is judged now.
 */
export async function technicianCompetentForJobService(params: {
  organizationId: string;
  technicianId: string;
  serviceId: number;
}): Promise<boolean> {
  const [jobService] = await db
    .select({ assetTypeId: service.assetTypeId })
    .from(service)
    .where(
      and(
        eq(service.id, params.serviceId),
        eq(service.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!jobService?.assetTypeId) return true;

  return technicianHasCompetence({
    organizationId: params.organizationId,
    technicianId: params.technicianId,
    assetTypeId: jobService.assetTypeId,
    performedAt: new Date(),
  });
}

/** The refusal both commands answer with when the competence gate says no. */
export function technicianCompetenceMissing() {
  return invalid(
    "technician_competence_missing",
    "Técnico não possui competência ativa para este tipo de instrumento",
  );
}

/** The refusal both commands answer with when the technician may not be assigned. */
export function technicianNotFound() {
  return invalid(
    "technician_not_found",
    "Tecnico nao encontrado ou sem permissao",
  );
}
