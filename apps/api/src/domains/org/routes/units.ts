import { createRouter } from "../../../server/router";
import { slugify } from "@calibra-facil/shared/text";
import { unitEndpoints } from "@calibra-facil/contracts";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  member,
  memberUnitAssignment,
  type MemberUnitRole,
  organizationEventLog,
  organizationUnit,
  user,
} from "@calibra-facil/db/schema";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { ORGANIZATION_UNIT_MACHINE } from "@calibra-facil/schemas/machines";
import {
  type AuthVariables,
  type MemberData,
  getGovernanceAccess,
  requireLabProtected,
  requireOrgType,
  withLabPermission,
} from "../../../middleware/permission";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { isUniqueViolation } from "../../../lib/db-errors";
import {
  conflict,
  forbidden,
  invalid,
  notFound,
} from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import { rolesAllowedTo } from "@calibra-facil/auth/access";
import type { RoleName } from "@calibra-facil/auth/access";

/**
 * Roles capable of APPROVING a calibration, derived from the role definitions
 * (`rolesAllowedTo`) rather than a hand-written "is admin" rule, so it stays in
 * sync if the workflow authority ever changes. Today this is `["admin", "owner"]`.
 */
const CALIBRATION_APPROVER_ROLES: RoleName[] = rolesAllowedTo("approve");

/**
 * Whether a (possibly free-form) member role can approve calibrations. Uses a
 * value comparison so an untyped DB `role` string narrows without an assertion.
 */
function isCalibrationApprover(role: string): boolean {
  return CALIBRATION_APPROVER_ROLES.some((approver) => approver === role);
}

const CALIBRATING_BODY_FIELDS = [
  "legalName",
  "cnpj",
  "street",
  "number",
  "complement",
  "neighbourhood",
  "city",
  "state",
  "cep",
] as const;

/** The laboratory's unit, or a 404. */
async function requireLabUnit(
  id: number,
  organizationId: string,
  o: Pick<OrgDb, "select">,
) {
  const [existing] = await o
    .select()
    .from(organizationUnit)
    .where(
      and(
        eq(organizationUnit.id, id),
        eq(organizationUnit.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw notFound("unit_not_found", "Unidade não encontrada");
  return existing;
}

/** The laboratory's member, or a 404. */
async function requireLabMember(
  memberId: string,
  organizationId: string,
  o: Pick<OrgDb, "select">,
) {
  const [targetMember] = await o
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
    )
    .limit(1);
  if (!targetMember) {
    throw notFound("member_not_found", "Membro não encontrado");
  }
  return targetMember;
}

async function allocateUnitSlug(
  // The caller's org-bound transaction (row-level security).
  o: Pick<OrgDb, "select">,
  params: {
    organizationId: string;
    name: string;
    excludeId?: number;
  },
) {
  const baseSlug = slugify(params.name) || "unit";

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const [existing] = await o
      .select({ id: organizationUnit.id })
      .from(organizationUnit)
      .where(
        and(
          eq(organizationUnit.organizationId, params.organizationId),
          eq(organizationUnit.slug, candidate),
          params.excludeId
            ? ne(organizationUnit.id, params.excludeId)
            : undefined,
        ),
      )
      .limit(1);

    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Nao foi possivel gerar um slug unico para a unidade");
}

function getViewerAccess(c: { get: (key: "member") => MemberData }) {
  const memberData = c.get("member");
  return {
    memberData,
    viewer: getGovernanceAccess(memberData),
  };
}

function dedupeUnitAssignments(
  assignments: Array<{ unitId: number; role: MemberUnitRole }>,
) {
  return Array.from(
    new Map(
      assignments.map((assignment) => [assignment.unitId, assignment]),
    ).values(),
  );
}

function getScopeSummary(
  memberData: MemberData,
  viewer: ReturnType<typeof getGovernanceAccess>,
) {
  const activeUnit = memberData.accessibleUnits.find(
    (unit) => unit.id === memberData.activeUnitId,
  );

  const effectiveRole =
    memberData.role === "owner" || memberData.role === "admin"
      ? "global_manager"
      : memberData.unitRole === "unit_admin"
        ? "unit_admin"
        : memberData.unitRole === "technician"
          ? "technician"
          : "member";

  return {
    isConsolidated: memberData.selectedUnitScope === "all",
    activeUnitId: memberData.activeUnitId,
    activeUnitName: activeUnit?.name ?? memberData.activeUnitName,
    accessibleUnitsCount: memberData.accessibleUnits.length,
    managedUnitsCount: viewer.managedUnitIds.length,
    effectiveRole,
    effectiveRoleLabel:
      effectiveRole === "global_manager"
        ? "Administrador global"
        : effectiveRole === "unit_admin"
          ? "Administrador de unidade"
          : effectiveRole === "technician"
            ? "Técnico"
            : "Membro",
    label:
      memberData.selectedUnitScope === "all"
        ? "Visão consolidada"
        : (activeUnit?.name ?? memberData.activeUnitName ?? "Unidade ativa"),
    description:
      memberData.selectedUnitScope === "all"
        ? "Operando em visão consolidada para todas as unidades acessíveis."
        : activeUnit
          ? `Operando com foco operacional em ${activeUnit.name}.`
          : "Selecione uma unidade para operar.",
  };
}

const PREFIX = "/api/units";

export const unitsRouter = createRouter<{ Variables: AuthVariables }>();

/** The governance routes: a LAB organization member past the protected-route gate. */
const labGovernance = [...requireLabProtected, requireOrgType("LAB")];

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.getDashboardUnits,
  withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const { memberData, viewer } = getViewerAccess(c);

    return {
      activeUnitId: memberData.activeUnitId,
      activeUnitName: memberData.activeUnitName,
      selectedUnitScope: memberData.selectedUnitScope,
      canAccessAllUnits: memberData.canAccessAllUnits,
      viewer,
      scopeSummary: getScopeSummary(memberData, viewer),
      data: memberData.accessibleUnits,
    };
  },
);
mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.listAdminUnits,
  labGovernance,
  async (c) => {
    const { memberData, viewer } = getViewerAccess(c);

    if (!viewer.canViewGovernance) {
      throw forbidden("forbidden", "Permissão insuficiente");
    }

    const units = await orgDb(memberData.organizationId).transaction((o) =>
      o
        .select({
          id: organizationUnit.id,
          name: organizationUnit.name,
          slug: organizationUnit.slug,
          status: organizationUnit.status,
          isDefault: organizationUnit.isDefault,
          createdAt: organizationUnit.createdAt,
          archivedAt: organizationUnit.archivedAt,
          legalName: organizationUnit.legalName,
          cnpj: organizationUnit.cnpj,
          street: organizationUnit.street,
          number: organizationUnit.number,
          complement: organizationUnit.complement,
          neighbourhood: organizationUnit.neighbourhood,
          city: organizationUnit.city,
          state: organizationUnit.state,
          cep: organizationUnit.cep,
        })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.organizationId, memberData.organizationId),
            viewer.isGlobalManager
              ? undefined
              : inArray(organizationUnit.id, viewer.managedUnitIds),
          ),
        )
        .orderBy(asc(organizationUnit.name)),
    );

    return { data: units, viewer };
  },
);

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.createAdminUnit,
  labGovernance,
  async (c, { body: input }) => {
    const { memberData, viewer } = getViewerAccess(c);

    if (!viewer.canManageOrganizationUnits) {
      throw forbidden(
        "forbidden",
        "Apenas administradores globais podem criar unidades",
      );
    }

    const created = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        let unit: typeof organizationUnit.$inferSelect | undefined;

        // One savepoint per attempt: a unique violation aborts it, and the
        // retry allocates a fresh slug in a new one.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            [unit] = await ctx.o.transaction(async (o) => {
              const slug = await allocateUnitSlug(o, {
                organizationId: memberData.organizationId,
                name: input.name,
              });

              const rows = await o
                .insert(organizationUnit)
                .values({
                  organizationId: memberData.organizationId,
                  name: input.name,
                  slug,
                  status: "ACTIVE",
                  isDefault: false,
                  createdBy: ctx.actor.userId,
                })
                .returning();

              const [inserted] = rows;
              if (inserted) {
                await o.insert(organizationEventLog).values({
                  organizationId: memberData.organizationId,
                  unitId: inserted.id,
                  actorUserId: ctx.actor.userId,
                  actorMemberId: memberData.id,
                  action: "unit.created",
                  entityType: "organization_unit",
                  entityId: String(inserted.id),
                  details: {
                    name: input.name,
                    slug: inserted.slug,
                  },
                });
              }

              return rows;
            });
            break;
          } catch (error) {
            if (!isUniqueViolation(error) || attempt === 1) {
              throw error;
            }
          }
        }

        return unit;
      },
    );

    if (!created) {
      throw new Error("Falha ao criar unidade");
    }

    return created;
  },
);

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.updateAdminUnit,
  labGovernance,
  async (c, { params, body: input }) => {
    const { memberData, viewer } = getViewerAccess(c);
    const id = Number.parseInt(params.id, 10);

    if (!viewer.canManageOrganizationUnits) {
      throw forbidden(
        "forbidden",
        "Apenas administradores globais podem atualizar unidades",
      );
    }

    if (!Number.isInteger(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    const existing = await orgDb(memberData.organizationId).transaction((o) =>
      requireLabUnit(id, memberData.organizationId, o),
    );

    if (input.status === "ARCHIVED" && existing.isDefault) {
      throw invalid(
        "unit_default_not_archivable",
        "A unidade padrão não pode ser arquivada",
      );
    }

    const updateData: Partial<typeof existing> = {};
    const renamed = Boolean(input.name && input.name !== existing.name);
    if (input.name && renamed) {
      updateData.name = input.name;
    }

    if (input.status && input.status !== existing.status) {
      // `archive` / `reactivate` of ORGANIZATION_UNIT_MACHINE.
      updateData.status = ORGANIZATION_UNIT_MACHINE.requireTransition(
        existing.status,
        input.status === "ARCHIVED" ? "archive" : "reactivate",
        input.status,
      );
      updateData.archivedAt = input.status === "ARCHIVED" ? new Date() : null;
    }

    // The calibrating-body fields that actually change.
    const bodyBefore: Record<string, string | null> = {};
    const bodyAfter: Record<string, string | null> = {};
    for (const field of CALIBRATING_BODY_FIELDS) {
      const next = input.calibratingBody?.[field];
      if (next === undefined || next === existing[field]) continue;
      bodyBefore[field] = existing[field];
      bodyAfter[field] = next;
      updateData[field] = next;
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    const updated = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        let result: typeof existing | undefined;

        // One savepoint per attempt: a unique violation aborts it, and the
        // retry allocates a fresh slug in a new one.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            [result] = await ctx.o.transaction(async (o) => {
              if (input.name && renamed) {
                updateData.slug = await allocateUnitSlug(o, {
                  organizationId: memberData.organizationId,
                  name: input.name,
                  excludeId: id,
                });
              }

              const rows = await o
                .update(organizationUnit)
                .set(updateData)
                // Compare-and-set on the status the checks above read.
                .where(
                  and(
                    eq(organizationUnit.id, id),
                    eq(organizationUnit.status, existing.status),
                  ),
                )
                .returning();

              await o.insert(organizationEventLog).values({
                organizationId: memberData.organizationId,
                unitId: id,
                actorUserId: ctx.actor.userId,
                actorMemberId: memberData.id,
                action:
                  input.status === "ARCHIVED"
                    ? "unit.archived"
                    : input.status === "ACTIVE" &&
                        existing.status === "ARCHIVED"
                      ? "unit.reactivated"
                      : "unit.updated",
                entityType: "organization_unit",
                entityId: String(id),
                details: {
                  before: {
                    name: existing.name,
                    slug: existing.slug,
                    status: existing.status,
                    ...bodyBefore,
                  },
                  after: updateData,
                },
              });

              return rows;
            });
            break;
          } catch (error) {
            if (!isUniqueViolation(error) || attempt === 1) {
              throw error;
            }
          }
        }

        return result;
      },
    );

    // The compare-and-set matched no row: the unit changed status between the
    // read above and this write.
    if (!updated) {
      throw conflict(
        "concurrent_update",
        "A unidade foi alterada por outra pessoa. Recarregue e tente novamente.",
      );
    }

    return updated;
  },
);

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.listAdminMembers,
  labGovernance,
  async (c) => {
    const { memberData, viewer } = getViewerAccess(c);

    if (!viewer.canViewGovernance) {
      throw forbidden("forbidden", "Permissão insuficiente");
    }

    return orgDb(memberData.organizationId).transaction(async (o) => {
      const assignments = await o
        .select({
          memberId: memberUnitAssignment.memberId,
          unitId: memberUnitAssignment.unitId,
          role: memberUnitAssignment.role,
          unitName: organizationUnit.name,
        })
        .from(memberUnitAssignment)
        .innerJoin(
          organizationUnit,
          eq(memberUnitAssignment.unitId, organizationUnit.id),
        )
        .where(
          and(
            eq(memberUnitAssignment.organizationId, memberData.organizationId),
            eq(organizationUnit.organizationId, memberData.organizationId),
            viewer.isGlobalManager
              ? undefined
              : inArray(memberUnitAssignment.unitId, viewer.managedUnitIds),
          ),
        )
        .orderBy(asc(organizationUnit.name));

      const visibleMemberIds = viewer.isGlobalManager
        ? null
        : Array.from(
            new Set(assignments.map((assignment) => assignment.memberId)),
          );

      const members =
        visibleMemberIds && visibleMemberIds.length === 0
          ? []
          : await o
              .select({
                id: member.id,
                userId: member.userId,
                role: member.role,
                name: user.name,
                email: user.email,
                createdAt: member.createdAt,
              })
              .from(member)
              .innerJoin(user, eq(member.userId, user.id))
              .where(
                and(
                  eq(member.organizationId, memberData.organizationId),
                  visibleMemberIds
                    ? inArray(member.id, visibleMemberIds)
                    : undefined,
                ),
              )
              .orderBy(asc(user.name));

      const assignmentsByMember = new Map<
        string,
        Array<{
          unitId: number;
          role: MemberUnitRole;
          unitName: string;
        }>
      >();

      for (const assignment of assignments) {
        const current = assignmentsByMember.get(assignment.memberId) ?? [];
        current.push({
          unitId: assignment.unitId,
          role: assignment.role,
          unitName: assignment.unitName,
        });
        assignmentsByMember.set(assignment.memberId, current);
      }

      return {
        viewer,
        data: members.map((item) => ({
          ...item,
          assignments: assignmentsByMember.get(item.id) ?? [],
        })),
      };
    });
  },
);

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.listAdminActivity,
  labGovernance,
  async (c) => {
    const { memberData, viewer } = getViewerAccess(c);

    if (!viewer.canViewGovernance) {
      throw forbidden("forbidden", "Permissão insuficiente");
    }

    return orgDb(memberData.organizationId).transaction(async (o) => {
      const events = await o
        .select({
          id: organizationEventLog.id,
          action: organizationEventLog.action,
          entityType: organizationEventLog.entityType,
          entityId: organizationEventLog.entityId,
          unitId: organizationEventLog.unitId,
          details: organizationEventLog.details,
          createdAt: organizationEventLog.createdAt,
          actorUserId: organizationEventLog.actorUserId,
          actorUserName: user.name,
          actorUserEmail: user.email,
          unitName: organizationUnit.name,
        })
        .from(organizationEventLog)
        .leftJoin(user, eq(organizationEventLog.actorUserId, user.id))
        .leftJoin(
          organizationUnit,
          eq(organizationEventLog.unitId, organizationUnit.id),
        )
        .where(
          eq(organizationEventLog.organizationId, memberData.organizationId),
        )
        .orderBy(desc(organizationEventLog.createdAt))
        .limit(80);

      const filteredEvents = viewer.isGlobalManager
        ? events
        : events.filter((event) => {
            if (event.unitId && viewer.managedUnitIds.includes(event.unitId)) {
              return true;
            }

            const scopedUnitIds = Array.isArray(event.details?.scopedUnitIds)
              ? event.details.scopedUnitIds
                  .map((value) => Number(value))
                  .filter((value) => Number.isInteger(value))
              : [];

            return scopedUnitIds.some((unitId) =>
              viewer.managedUnitIds.includes(unitId),
            );
          });

      return {
        viewer,
        data: filteredEvents.slice(0, 20).map((event) => ({
          id: event.id,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          createdAt: event.createdAt,
          details: event.details,
          unit: event.unitId
            ? {
                id: event.unitId,
                name: event.unitName ?? "Unidade removida",
              }
            : null,
          actorUser: event.actorUserId
            ? {
                id: event.actorUserId,
                name: event.actorUserName ?? "Usuário removido",
                email: event.actorUserEmail ?? null,
              }
            : null,
        })),
      };
    });
  },
);

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.updateMemberAssignments,
  labGovernance,
  async (c, { params, body: input }) => {
    const { memberData, viewer } = getViewerAccess(c);
    const targetMemberId = params.memberId;

    if (!viewer.canManageAssignments) {
      throw forbidden(
        "forbidden",
        "Permissão insuficiente para editar atribuições",
      );
    }

    const dedupedAssignments = dedupeUnitAssignments(input.assignments);

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const targetMember = await requireLabMember(
        targetMemberId,
        memberData.organizationId,
        ctx.o,
      );

      if (
        !viewer.isGlobalManager &&
        ["owner", "admin"].includes(targetMember.role)
      ) {
        throw forbidden(
          "forbidden",
          "Papéis globais não podem ser gerenciados por administradores de unidade",
        );
      }

      const unitIds = dedupedAssignments.map((assignment) => assignment.unitId);

      if (
        !viewer.isGlobalManager &&
        unitIds.some((unitId) => !viewer.managedUnitIds.includes(unitId))
      ) {
        throw forbidden(
          "forbidden",
          "Uma ou mais unidades estão fora do seu escopo de gestão",
        );
      }

      const units =
        unitIds.length === 0
          ? []
          : await ctx.o
              .select({ id: organizationUnit.id })
              .from(organizationUnit)
              .where(
                and(
                  eq(
                    organizationUnit.organizationId,
                    memberData.organizationId,
                  ),
                  inArray(organizationUnit.id, unitIds),
                ),
              );

      if (units.length !== unitIds.length) {
        throw invalid(
          "invalid_request",
          "Uma ou mais unidades informadas são inválidas",
        );
      }

      const existingAssignments = await ctx.o
        .select({
          unitId: memberUnitAssignment.unitId,
          role: memberUnitAssignment.role,
        })
        .from(memberUnitAssignment)
        .where(
          and(
            eq(memberUnitAssignment.organizationId, memberData.organizationId),
            eq(memberUnitAssignment.memberId, targetMemberId),
          ),
        );

      // Global managers can remove assignments that already exist as well as any
      // units included in the incoming payload. Scoped managers can only delete
      // assignments for units they manage.
      const editableUnitIds = viewer.isGlobalManager
        ? existingAssignments
            .map((assignment) => assignment.unitId)
            .concat(unitIds)
        : viewer.managedUnitIds;

      // Deduping here keeps the subsequent inArray delete filter scoped to the
      // unique set of unit IDs this viewer is allowed to affect.
      const scopedEditableUnitIds = Array.from(new Set(editableUnitIds));
      const scopedUnitIds = Array.from(
        new Set(
          existingAssignments
            .map((assignment) => assignment.unitId)
            .concat(unitIds),
        ),
      );

      if (scopedEditableUnitIds.length > 0) {
        await ctx.o
          .delete(memberUnitAssignment)
          .where(
            and(
              eq(memberUnitAssignment.memberId, targetMemberId),
              eq(
                memberUnitAssignment.organizationId,
                memberData.organizationId,
              ),
              inArray(memberUnitAssignment.unitId, scopedEditableUnitIds),
            ),
          );
      }

      if (dedupedAssignments.length > 0) {
        await ctx.o.insert(memberUnitAssignment).values(
          dedupedAssignments.map((assignment) => ({
            organizationId: memberData.organizationId,
            memberId: targetMemberId,
            unitId: assignment.unitId,
            role: assignment.role,
            createdBy: ctx.actor.userId,
          })),
        );
      }

      await ctx.o.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        actorUserId: ctx.actor.userId,
        actorMemberId: memberData.id,
        action: "unit.assignments.updated",
        entityType: "member",
        entityId: targetMemberId,
        details: {
          managedUnitIds: viewer.managedUnitIds,
          scopedUnitIds,
          before: existingAssignments,
          after: dedupedAssignments,
        },
      });
    });

    return { success: true as const };
  },
);

mount(
  unitsRouter,
  PREFIX,
  unitEndpoints.updateMemberRole,
  labGovernance,
  async (c, { params, body: input }) => {
    const { memberData, viewer } = getViewerAccess(c);
    const targetMemberId = params.memberId;

    if (!viewer.canManageGlobalRoles) {
      throw forbidden(
        "forbidden",
        "Apenas administradores globais podem alterar papéis globais",
      );
    }

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const targetMember = await requireLabMember(
        targetMemberId,
        memberData.organizationId,
        ctx.o,
      );

      if (targetMember.role === "owner") {
        throw invalid(
          "invalid_request",
          "O proprietário da organização não pode ser alterado aqui",
        );
      }

      if (targetMember.role === input.role) {
        return;
      }

      // Separation of duties (ISO/IEC 17025 6.2.4): the organization must always
      // retain at least one member able to approve/reject calibrations. If this
      // change would drop the target out of the approver set, ensure another
      // approver remains — scoped to the organization.
      if (
        isCalibrationApprover(targetMember.role) &&
        !isCalibrationApprover(input.role)
      ) {
        const [remainingApprovers] = await ctx.o
          .select({ value: count() })
          .from(member)
          .where(
            and(
              eq(member.organizationId, memberData.organizationId),
              ne(member.id, targetMemberId),
              inArray(member.role, CALIBRATION_APPROVER_ROLES),
            ),
          );

        if ((remainingApprovers?.value ?? 0) === 0) {
          throw conflict(
            "LAST_CALIBRATION_APPROVER",
            "Não é possível rebaixar o último membro capaz de aprovar calibrações. A organização precisa manter ao menos um aprovador (separação de funções, ISO/IEC 17025 6.2.4).",
          );
        }
      }

      await ctx.o
        .update(member)
        .set({ role: input.role })
        .where(eq(member.id, targetMemberId));

      await ctx.o.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        actorUserId: ctx.actor.userId,
        actorMemberId: memberData.id,
        action: "member.role.updated",
        entityType: "member",
        entityId: targetMemberId,
        details: {
          before: { role: targetMember.role },
          after: { role: input.role },
        },
      });
    });

    return { success: true as const };
  },
);
