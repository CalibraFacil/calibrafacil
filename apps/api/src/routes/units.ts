import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  member,
  memberUnitAssignment,
  organizationEventLog,
  organizationUnit,
  user,
} from "@calibra-facil/db/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  type AuthVariables,
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

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const unitsRouter = new Hono<{ Variables: AuthVariables }>()
  .get("/", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const memberData = c.get("member");

    return c.json({
      activeUnitId: memberData.activeUnitId,
      activeUnitName: memberData.activeUnitName,
      selectedUnitScope: memberData.selectedUnitScope,
      canAccessAllUnits: memberData.canAccessAllUnits,
      data: memberData.accessibleUnits,
    });
  })
  .get(
    "/admin/units",
    ...withLabPermission({ settings: ["update"] }),
    async (c) => {
      const memberData = c.get("member");

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
        .where(eq(organizationUnit.organizationId, memberData.organizationId))
        .orderBy(asc(organizationUnit.name));

      return c.json({ data: units });
    },
  )
  .post(
    "/admin/units",
    ...withLabPermission({ settings: ["update"] }),
    zValidator("json", CreateUnitSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
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
    ...withLabPermission({ settings: ["update"] }),
    zValidator("json", UpdateUnitSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

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
        action: "unit.updated",
        entityType: "organization_unit",
        entityId: String(id),
        details: updateData,
      });

      return c.json(updated);
    },
  )
  .get(
    "/admin/members",
    ...withLabPermission({ settings: ["update"] }),
    async (c) => {
      const memberData = c.get("member");

      const members = await db
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
        .where(eq(member.organizationId, memberData.organizationId))
        .orderBy(asc(user.name));

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
        .where(eq(memberUnitAssignment.organizationId, memberData.organizationId))
        .orderBy(asc(organizationUnit.name));

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
        data: members.map((item) => ({
          ...item,
          assignments: assignmentsByMember.get(item.id) ?? [],
        })),
      });
    },
  )
  .put(
    "/admin/members/:memberId/assignments",
    ...withLabPermission({ settings: ["update"] }),
    zValidator("json", UpdateAssignmentsSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const targetMemberId = c.req.param("memberId");
      const input = c.req.valid("json");

      const [targetMember] = await db
        .select({ id: member.id })
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

      const unitIds = input.assignments.map((assignment) => assignment.unitId);
      const units = await db
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

      await db
        .delete(memberUnitAssignment)
        .where(eq(memberUnitAssignment.memberId, targetMemberId));

      if (input.assignments.length > 0) {
        await db.insert(memberUnitAssignment).values(
          input.assignments.map((assignment) => ({
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
          assignments: input.assignments,
        },
      });

      return c.json({ success: true });
    },
  );
