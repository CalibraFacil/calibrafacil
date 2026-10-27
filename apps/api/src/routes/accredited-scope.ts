import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { orgDb } from "../lib/org-db";
import { writeComplianceAuditEvent } from "../lib/compliance-audit";
import {
  accreditedScopeLine,
  accreditedScopeLineAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { AccreditedScopeLineSchema } from "@calibra-facil/schemas";
import { resolveScopeEnforcementMode, unitKind } from "@calibra-facil/shared";
import {
  requireLabProtected,
  requireOrgType,
  requirePermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
} from "../lib/unit-operational-settings";
import { clientIp } from "../lib/client-ip";

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
 * managers and leave an append-only audit trail. The org-level enforcement mode
 * is the exception: it needs the organization `settings:update` permission.
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

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [lines, [org]] = await Promise.all([
        tx
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
          ),
        tx
          .select({
            scopeEnforcementMode: organization.scopeEnforcementMode,
            accreditationActive: organization.accreditationActive,
          })
          .from(organization)
          .where(eq(organization.id, memberData.organizationId))
          .limit(1),
      ]);

      return c.json({
        lines,
        unit,
        // The EFFECTIVE mode (Q45); a lab that never chose gets the default.
        enforcementMode: resolveScopeEnforcementMode({
          stored: org?.scopeEnforcementMode,
          accreditationActive: org?.accreditationActive,
        }),
        enforcementModeIsDefault: !org?.scopeEnforcementMode,
      });
    });
  })

  // ===========================================================================
  // PUT /enforcement - Switch the org-level guard mode (#427 Phase 1)
  // ===========================================================================
  .put(
    "/enforcement",
    ...requireLabProtected,
    requireOrgType("LAB"),
    // organization.scopeEnforcementMode governs EVERY unit's accredited
    // approvals, so it is an organization-level settings write (owner/admin).
    // A single-unit unit_admin must not be able to relax it org-wide.
    requirePermission({ settings: ["update"] }),
    zValidator("json", z.object({ mode: z.enum(["warn", "enforce"]) })),
    async (c) => {
      const input = c.req.valid("json");
      const memberData = c.get("member");
      const session = c.get("session");

      return await orgDb(memberData.organizationId).transaction(async (tx) => {
        const [before] = await tx
          .select({
            scopeEnforcementMode: organization.scopeEnforcementMode,
            accreditationActive: organization.accreditationActive,
          })
          .from(organization)
          .where(eq(organization.id, memberData.organizationId))
          .limit(1);

        // What was in force (Q45: for a lab that never chose, the default),
        // so the trail reads "enforce -> warn" even when the stored value was
        // still unset.
        const effectiveBefore = before
          ? resolveScopeEnforcementMode({
              stored: before.scopeEnforcementMode,
              accreditationActive: before.accreditationActive,
            })
          : null;

        // The mode change and its audit row commit (or fail) together. Choosing
        // a mode makes it explicit, even one equal to the default: from then on
        // the lab's choice is never overridden by the default.
        await tx
          .update(organization)
          .set({ scopeEnforcementMode: input.mode })
          .where(eq(organization.id, memberData.organizationId));

        // Audited whenever the effective mode changes, or a default becomes an
        // explicit choice (the record that the lab chose, and by whom).
        if (
          before &&
          (effectiveBefore !== input.mode || !before.scopeEnforcementMode)
        ) {
          await tx.insert(accreditedScopeLineAuditLog).values({
            scopeLineId: null,
            organizationId: memberData.organizationId,
            action: "enforcement_mode_change",
            changes: {
              scopeEnforcementMode: {
                old: effectiveBefore,
                new: input.mode,
              },
              wasDefault: !before.scopeEnforcementMode,
            },
            performedBy: session.user.id,
            ipAddress: clientIp(c),
          });
          // B4a: also on the compliance trail the accreditation profile uses.
          await writeComplianceAuditEvent(
            {
              organizationId: memberData.organizationId,
              action: "accreditation.scope_enforcement_changed",
              entityType: "organization",
              entityId: memberData.organizationId,
              changes: {
                before: {
                  scopeEnforcementMode: effectiveBefore,
                  wasDefault: !before.scopeEnforcementMode,
                },
                after: { scopeEnforcementMode: input.mode },
              },
              performedBy: session.user.id,
              ipAddress: c.req.header("x-forwarded-for") || null,
            },
            tx,
          );
        }

        return c.json({
          message:
            input.mode === "enforce"
              ? "Guarda de escopo ativada: violações bloqueiam a emissão acreditada"
              : "Guarda de escopo em modo aviso",
          enforcementMode: input.mode,
        });
      });
    },
  )

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

      return await orgDb(memberData.organizationId).transaction(async (tx) => {
        if (input.id != null) {
          const [existing] = await tx
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

          const [updated] = await tx
            .update(accreditedScopeLine)
            .set({
              ...values,
              // Omitted on the wire = preserve; the web dialog has no k field.
              coverageFactor: input.coverageFactor ?? existing.coverageFactor,
            })
            .where(eq(accreditedScopeLine.id, existing.id))
            .returning();

          if (updated) {
            await tx.insert(accreditedScopeLineAuditLog).values({
              scopeLineId: existing.id,
              organizationId: memberData.organizationId,
              action: "update",
              changes: diffScopeLine(existing, updated),
              performedBy: session.user.id,
              ipAddress: clientIp(c),
            });
          }

          return c.json({
            message: "Linha de escopo atualizada",
            data: updated,
            unit,
          });
        }

        const [created] = await tx
          .insert(accreditedScopeLine)
          .values({
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            ...values,
            coverageFactor: input.coverageFactor ?? 2,
          })
          .returning();

        if (created) {
          await tx.insert(accreditedScopeLineAuditLog).values({
            scopeLineId: created.id,
            organizationId: memberData.organizationId,
            action: "create",
            changes: null,
            performedBy: session.user.id,
            ipAddress: clientIp(c),
          });
        }

        return c.json({
          message: "Linha de escopo adicionada",
          data: created,
          unit,
        });
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

    return await orgDb(memberData.organizationId).transaction(async (tx) => {
      const [deleted] = await tx
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

      await tx.insert(accreditedScopeLineAuditLog).values({
        scopeLineId: deleted.id,
        organizationId: memberData.organizationId,
        action: "delete",
        changes: null,
        performedBy: session.user.id,
        ipAddress: clientIp(c),
      });

      return c.json({ message: "Linha de escopo removida" });
    });
  });
