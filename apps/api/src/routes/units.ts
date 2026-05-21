import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  member,
  memberUnitAssignment,
  type MemberUnitRole,
  organizationEventLog,
  organizationUnit,
  user,
} from "@calibra-facil/db/schema";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import {
  type AuthVariables,
  type MemberData,
  getGovernanceAccess,
  requireLabProtected,
  requireOrgType,
  withLabPermission,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";

const CreateUnitSchema = z.object({
  name: z.string().trim().min(2, "Nome da unidade é obrigatório"),
});

const UpdateUnitSchema = z.object({
  name: z.string().trim().min(2).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

const UpdateAssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      unitId: z.coerce.number().int().positive(),
      role: z.enum(["member", "technician", "unit_admin"]),
    }),
  ),
});

const UpdateMemberRoleSchema = z.object({
  role: z.enum(["member", "operator", "technician", "admin"]),
});

function slugify(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "unit";
}

function isUniqueViolation(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;

  return (
    typeof code === "string" &&
    code === "23505"
  );
}

async function allocateUnitSlug(params: {
  organizationId: string;
  name: string;
  excludeId?: number;
}) {
  const baseSlug = slugify(params.name);

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const [existing] = await db
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

export const unitsRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/",
    ...withLabPermission({ calibration: ["read"] }),
    requireFeature("multi_unit"),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);

      return c.json({
        activeUnitId: memberData.activeUnitId,
        activeUnitName: memberData.activeUnitName,
        selectedUnitScope: memberData.selectedUnitScope,
        canAccessAllUnits: memberData.canAccessAllUnits,
        viewer,
        scopeSummary: getScopeSummary(memberData, viewer),
        data: memberData.accessibleUnits,
      });
    },
  )
  .get(
    "/admin/units",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireFeature("multi_unit"),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);

      if (!viewer.canViewGovernance) {
        return c.json({ error: "Permissão insuficiente" }, 403);
      }

      const units = await db
        .select({
          id: organizationUnit.id,
          name: organizationUnit.name,
          slug: organizationUnit.slug,
          status: organizationUnit.status,
          isDefault: organizationUnit.isDefault,
          createdAt: organizationUnit.createdAt,
          archivedAt: organizationUnit.archivedAt,
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
        .orderBy(asc(organizationUnit.name));

      return c.json({ data: units, viewer });
    },
  )
  .post(
    "/admin/units",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireFeature("multi_unit"),
    zValidator("json", CreateUnitSchema),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);
      const session = c.get("session");
      const input = c.req.valid("json");
      let created: typeof organizationUnit.$inferSelect | undefined;

      if (!viewer.canManageOrganizationUnits) {
        return c.json(
          { error: "Apenas administradores globais podem criar unidades" },
          403,
        );
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const slug = await allocateUnitSlug({
          organizationId: memberData.organizationId,
          name: input.name,
        });

        try {
          [created] = await db
            .insert(organizationUnit)
            .values({
              organizationId: memberData.organizationId,
              name: input.name,
              slug,
              status: "ACTIVE",
              isDefault: false,
              createdBy: session.user.id,
            })
            .returning();
          break;
        } catch (error) {
          if (!isUniqueViolation(error) || attempt === 1) {
            throw error;
          }
        }
      }

      if (!created) {
        return c.json({ error: "Falha ao criar unidade" }, 500);
      }

      await db.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        unitId: created.id,
        actorUserId: session.user.id,
        actorMemberId: memberData.id,
        action: "unit.created",
        entityType: "organization_unit",
        entityId: String(created.id),
        details: {
          name: input.name,
          slug: created.slug,
        },
      });

      return c.json(created, 201);
    },
  )
  .patch(
    "/admin/units/:id",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireFeature("multi_unit"),
    zValidator("json", UpdateUnitSchema),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!viewer.canManageOrganizationUnits) {
        return c.json(
          { error: "Apenas administradores globais podem atualizar unidades" },
          403,
        );
      }

      if (!Number.isInteger(id)) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.id, id),
            eq(organizationUnit.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Unidade não encontrada" }, 404);
      }

      if (input.status === "ARCHIVED" && existing.isDefault) {
        return c.json(
          { error: "A unidade padrão não pode ser arquivada" },
          400,
        );
      }

      const updateData: Partial<typeof existing> = {};
      if (input.name && input.name !== existing.name) {
        updateData.name = input.name;
        updateData.slug = await allocateUnitSlug({
          organizationId: memberData.organizationId,
          name: input.name,
          excludeId: id,
        });
      }

      if (input.status && input.status !== existing.status) {
        updateData.status = input.status;
        updateData.archivedAt = input.status === "ARCHIVED" ? new Date() : null;
      }

      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      let updated: typeof existing | undefined;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          [updated] = await db
            .update(organizationUnit)
            .set(updateData)
            .where(eq(organizationUnit.id, id))
            .returning();
          break;
        } catch (error) {
          if (!isUniqueViolation(error) || attempt === 1) {
            throw error;
          }

          if (input.name && input.name !== existing.name) {
            updateData.slug = await allocateUnitSlug({
              organizationId: memberData.organizationId,
              name: input.name,
              excludeId: id,
            });
          }
        }
      }

      await db.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        unitId: id,
        actorUserId: session.user.id,
        actorMemberId: memberData.id,
        action:
          input.status === "ARCHIVED"
            ? "unit.archived"
            : input.status === "ACTIVE" && existing.status === "ARCHIVED"
              ? "unit.reactivated"
              : "unit.updated",
        entityType: "organization_unit",
        entityId: String(id),
        details: {
          before: {
            name: existing.name,
            slug: existing.slug,
            status: existing.status,
          },
          after: updateData,
        },
      });

      return c.json(updated);
    },
  )
  .get(
    "/admin/members",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireFeature("multi_unit"),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);

      if (!viewer.canViewGovernance) {
        return c.json({ error: "Permissão insuficiente" }, 403);
      }

      const assignments = await db
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
          : await db
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
          role: string;
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

      return c.json({
        viewer,
        data: members.map((item) => ({
          ...item,
          assignments: assignmentsByMember.get(item.id) ?? [],
        })),
      });
    },
  )
  .get(
    "/admin/activity",
    ...requireLabProtected,
    requireOrgType("LAB"),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);

      if (!viewer.canViewGovernance) {
        return c.json({ error: "Permissão insuficiente" }, 403);
      }

      const events = await db
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

      return c.json({
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
      });
    },
  )
  .put(
    "/admin/members/:memberId/assignments",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireFeature("multi_unit"),
    zValidator("json", UpdateAssignmentsSchema),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);
      const session = c.get("session");
      const targetMemberId = c.req.param("memberId");
      const input = c.req.valid("json");

      if (!viewer.canManageAssignments) {
        return c.json(
          { error: "Permissão insuficiente para editar atribuições" },
          403,
        );
      }

      const dedupedAssignments = dedupeUnitAssignments(input.assignments);

      const [targetMember] = await db
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(
            eq(member.id, targetMemberId),
            eq(member.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!targetMember) {
        return c.json({ error: "Membro não encontrado" }, 404);
      }

      if (
        !viewer.isGlobalManager &&
        ["owner", "admin"].includes(targetMember.role)
      ) {
        return c.json(
          {
            error:
              "Papéis globais não podem ser gerenciados por administradores de unidade",
          },
          403,
        );
      }

      const unitIds = dedupedAssignments.map((assignment) => assignment.unitId);

      if (
        !viewer.isGlobalManager &&
        unitIds.some((unitId) => !viewer.managedUnitIds.includes(unitId))
      ) {
        return c.json(
          { error: "Uma ou mais unidades estão fora do seu escopo de gestão" },
          403,
        );
      }

      const units =
        unitIds.length === 0
          ? []
          : await db
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
        return c.json(
          { error: "Uma ou mais unidades informadas são inválidas" },
          400,
        );
      }

      const existingAssignments = await db
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
        await db
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
        await db.insert(memberUnitAssignment).values(
          dedupedAssignments.map((assignment) => ({
            organizationId: memberData.organizationId,
            memberId: targetMemberId,
            unitId: assignment.unitId,
            role: assignment.role,
            createdBy: session.user.id,
          })),
        );
      }

      await db.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        actorUserId: session.user.id,
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

      return c.json({ success: true });
    },
  )
  .patch(
    "/admin/members/:memberId/role",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", UpdateMemberRoleSchema),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);
      const session = c.get("session");
      const targetMemberId = c.req.param("memberId");
      const input = c.req.valid("json");

      if (!viewer.canManageGlobalRoles) {
        return c.json(
          {
            error:
              "Apenas administradores globais podem alterar papéis globais",
          },
          403,
        );
      }

      const [targetMember] = await db
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(
            eq(member.id, targetMemberId),
            eq(member.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!targetMember) {
        return c.json({ error: "Membro não encontrado" }, 404);
      }

      if (targetMember.role === "owner") {
        return c.json(
          { error: "O proprietário da organização não pode ser alterado aqui" },
          400,
        );
      }

      if (targetMember.role === input.role) {
        return c.json({ success: true });
      }

      await db
        .update(member)
        .set({ role: input.role })
        .where(eq(member.id, targetMemberId));

      await db.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        actorUserId: session.user.id,
        actorMemberId: memberData.id,
        action: "member.role.updated",
        entityType: "member",
        entityId: targetMemberId,
        details: {
          before: { role: targetMember.role },
          after: { role: input.role },
        },
      });

      return c.json({ success: true });
    },
  );
