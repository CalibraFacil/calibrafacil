import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  accreditedScopeLine,
  accreditedScopeLineAuditLog,
} from "@calibra-facil/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { AccreditedScopeLineSchema } from "@calibra-facil/schemas";
import { unitKind } from "@calibra-facil/shared";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../middleware/permission";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
} from "../lib/unit-operational-settings";

type ScopeLineRow = typeof accreditedScopeLine.$inferSelect;

/** Field-level diff for the §8.4 audit trail (only changed fields). */
function diffScopeLine(
  before: ScopeLineRow,
  after: ScopeLineRow,
): Record<string, { old: unknown; new: unknown }> {
  const keys = [
    "quantityKind",
    "rangeMin",
    "rangeMax",
    "rangeUnit",
    "cmcType",
    "cmcA",
    "cmcB",
    "cmcUnit",
    "coverageFactor",
    "description",
    "validFrom",
    "validUntil",
  ] satisfies ReadonlyArray<keyof ScopeLineRow>;
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of keys) {
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    const oldText =
      oldValue instanceof Date ? oldValue.toISOString() : oldValue;
    const newText =
      newValue instanceof Date ? newValue.toISOString() : newValue;
    if (oldText !== newText) {
      changes[key] = { old: oldText, new: newText };
    }
  }
  return changes;
}

/**
 * Accredited-scope (CMC) lines — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14 (#427).
 * Unit-scoped like environmental limits: Cgcre accredits each laboratory site
 * with its own scope. Writes are restricted to unit operational-settings
 * managers and leave an append-only audit trail.
 */
export const accreditedScopeRouter = new Hono<{
  Variables: AuthVariables;
}>()
  // ===========================================================================
  // GET / - List accredited-scope lines for the selected unit
  // ===========================================================================
  .get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const memberData = c.get("member");
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    const lines = await db
      .select()
      .from(accreditedScopeLine)
      .where(
        and(
          eq(accreditedScopeLine.organizationId, memberData.organizationId),
          eq(accreditedScopeLine.unitId, unit.unitId),
        ),
      )
      .orderBy(
        asc(accreditedScopeLine.quantityKind),
        asc(accreditedScopeLine.rangeMin),
      );

    return c.json({ lines, unit });
  })

  // ===========================================================================
  // PUT / - Create or update a scope line (id present = update)
  // ===========================================================================
  .put(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    zValidator("json", AccreditedScopeLineSchema),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");
      requireUnitOperationalSettingsManager(memberData);
      const unit = resolveAccessibleUnitContext(memberData);

      // The Zod schema cannot see the unit registry; enforce grandeza/unit
      // coherence here so a mass line can never carry a temperature unit.
      if (
        unitKind(input.rangeUnit) !== input.quantityKind ||
        unitKind(input.cmcUnit) !== input.quantityKind
      ) {
        return c.json(
          { error: "Unidades incompatíveis com a grandeza da linha" },
          400,
        );
      }

      const values = {
        quantityKind: input.quantityKind,
        rangeMin: input.rangeMin,
        rangeMax: input.rangeMax,
        rangeUnit: input.rangeUnit,
        cmcType: input.cmcType,
        cmcA: input.cmcA,
        cmcB: input.cmcType === "linear" ? (input.cmcB ?? null) : null,
        cmcUnit: input.cmcUnit,
        description: input.description ?? null,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        updatedBy: session.user.id,
      };

      if (input.id != null) {
        const [existing] = await db
          .select()
          .from(accreditedScopeLine)
          .where(
            and(
              eq(accreditedScopeLine.id, input.id),
              eq(
                accreditedScopeLine.organizationId,
                memberData.organizationId,
              ),
              eq(accreditedScopeLine.unitId, unit.unitId),
            ),
          )
          .limit(1);
        if (!existing) {
          return c.json({ error: "Linha de escopo não encontrada" }, 404);
        }

        const [updated] = await db
          .update(accreditedScopeLine)
          .set({
            ...values,
            // Omitted on the wire = preserve; the web dialog has no k field.
            coverageFactor: input.coverageFactor ?? existing.coverageFactor,
          })
          .where(eq(accreditedScopeLine.id, existing.id))
          .returning();

        if (updated) {
          await db.insert(accreditedScopeLineAuditLog).values({
            scopeLineId: existing.id,
            organizationId: memberData.organizationId,
            action: "update",
            changes: diffScopeLine(existing, updated),
            performedBy: session.user.id,
            ipAddress: c.req.header("x-forwarded-for") || null,
          });
        }

        return c.json({
          message: "Linha de escopo atualizada",
          data: updated,
          unit,
        });
      }

      const [created] = await db
        .insert(accreditedScopeLine)
        .values({
          organizationId: memberData.organizationId,
          unitId: unit.unitId,
          ...values,
          coverageFactor: input.coverageFactor ?? 2,
        })
        .returning();

      if (created) {
        await db.insert(accreditedScopeLineAuditLog).values({
          scopeLineId: created.id,
          organizationId: memberData.organizationId,
          action: "create",
          changes: null,
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });
      }

      return c.json({
        message: "Linha de escopo adicionada",
        data: created,
        unit,
      });
    },
  )

  // ===========================================================================
  // DELETE /:id - Remove a scope line (audit row survives, soft reference)
  // ===========================================================================
  .delete("/:id", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const memberData = c.get("member");
    const session = c.get("session");
    const id = parseInt(c.req.param("id"), 10);
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [deleted] = await db
      .delete(accreditedScopeLine)
      .where(
        and(
          eq(accreditedScopeLine.id, id),
          eq(accreditedScopeLine.organizationId, memberData.organizationId),
          eq(accreditedScopeLine.unitId, unit.unitId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json({ error: "Linha de escopo não encontrada" }, 404);
    }

    await db.insert(accreditedScopeLineAuditLog).values({
      scopeLineId: deleted.id,
      organizationId: memberData.organizationId,
      action: "delete",
      changes: null,
      performedBy: session.user.id,
      ipAddress: c.req.header("x-forwarded-for") || null,
    });

    return c.json({ message: "Linha de escopo removida" });
  });
