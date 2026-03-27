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
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  type AuthVariables,
  type MemberData,
  getGovernanceAccess,
  requireLabProtected,
  requireOrgType,
  withLabPermission,
} from "../middleware/permission";

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
  role: z.enum(["member", "technician", "admin"]),
});

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getViewerAccess(c: {
  get: (key: string) => unknown;
}) {
  const memberData = c.get("member") as MemberData;
  return {
    memberData,
    viewer: getGovernanceAccess(memberData),
  };
}

function dedupeUnitAssignments(
  assignments: Array<{ unitId: number; role: MemberUnitRole }>,
) {
  return Array.from(
    new Map(assignments.map((assignment) => [assignment.unitId, assignment])).values(),
  );
}

export const unitsRouter = new Hono<{ Variables: AuthVariables }>()
  .get("/", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const { memberData, viewer } = getViewerAccess(c);

    return c.json({
      activeUnitId: memberData.activeUnitId,
      activeUnitName: memberData.activeUnitName,
      selectedUnitScope: memberData.selectedUnitScope,
      canAccessAllUnits: memberData.canAccessAllUnits,
      viewer,
      data: memberData.accessibleUnits,
    });
  })
  .get(
    "/admin/units",
    ...requireLabProtected,
    requireOrgType("LAB"),
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
    zValidator("json", CreateUnitSchema),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);
      const session = c.get("session");
      const input = c.req.valid("json");

      if (!viewer.canManageOrganizationUnits) {
        return c.json({ error: "Apenas administradores globais podem criar unidades" }, 403);
      }

      const baseSlug = slugify(input.name);

      const [existingCount] = await db
        .select({ total: count() })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.organizationId, memberData.organizationId),
            inArray(organizationUnit.slug, [baseSlug, `${baseSlug}-2`]),
          ),
        );

      const suffix = (existingCount?.total ?? 0) + 1;
      const slug = suffix > 1 ? `${baseSlug}-${suffix}` : baseSlug;

      const [created] = await db
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

      await db.insert(organizationEventLog).values({
        organizationId: memberData.organizationId,
        unitId: created?.id ?? null,
        actorUserId: session.user.id,
        actorMemberId: memberData.id,
        action: "unit.created",
        entityType: "organization_unit",
        entityId: String(created?.id ?? ""),
        details: {
          name: input.name,
          slug,
        },
      });

      return c.json(created, 201);
    },
  )
  .patch(
    "/admin/units/:id",
    ...requireLabProtected,
    requireOrgType("LAB"),
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
        updateData.slug = slugify(input.name);
      }

      if (input.status && input.status !== existing.status) {
        updateData.status = input.status;
        updateData.archivedAt =
          input.status === "ARCHIVED" ? new Date() : null;
      }

      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      const [updated] = await db
        .update(organizationUnit)
        .set(updateData)
        .where(eq(organizationUnit.id, id))
        .returning();

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
            viewer.isGlobalManager
              ? undefined
              : inArray(memberUnitAssignment.unitId, viewer.managedUnitIds),
          ),
        )
        .orderBy(asc(organizationUnit.name));

      const visibleMemberIds = viewer.isGlobalManager
        ? null
        : Array.from(new Set(assignments.map((assignment) => assignment.memberId)));

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
                  visibleMemberIds ? inArray(member.id, visibleMemberIds) : undefined,
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
  .put(
    "/admin/members/:memberId/assignments",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", UpdateAssignmentsSchema),
    async (c) => {
      const { memberData, viewer } = getViewerAccess(c);
      const session = c.get("session");
      const targetMemberId = c.req.param("memberId");
      const input = c.req.valid("json");

      if (!viewer.canManageAssignments) {
        return c.json({ error: "Permissão insuficiente para editar atribuições" }, 403);
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

      if (!viewer.isGlobalManager && ["owner", "admin"].includes(targetMember.role)) {
        return c.json(
          { error: "Papéis globais não podem ser gerenciados por administradores de unidade" },
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
                  eq(organizationUnit.organizationId, memberData.organizationId),
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

      const editableUnitIds = viewer.isGlobalManager
        ? existingAssignments.map((assignment) => assignment.unitId).concat(unitIds)
        : viewer.managedUnitIds;

      const scopedEditableUnitIds = Array.from(new Set(editableUnitIds));

      if (scopedEditableUnitIds.length > 0) {
        await db
          .delete(memberUnitAssignment)
          .where(
            and(
              eq(memberUnitAssignment.memberId, targetMemberId),
              eq(memberUnitAssignment.organizationId, memberData.organizationId),
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
          { error: "Apenas administradores globais podem alterar papéis globais" },
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
