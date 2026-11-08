import { createRouter } from "../../../server/router";
import { accreditedScopeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { writeComplianceAuditEvent } from "../../../lib/compliance-audit";
import {
  accreditedScopeLine,
  accreditedScopeLineAuditLog,
  organization,
} from "@calibra-facil/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { resolveScopeEnforcementMode, unitKind } from "@calibra-facil/shared";
import {
  requireLabProtected,
  requireOrgType,
  requirePermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  requireUnitOperationalSettingsManager,
  resolveAccessibleUnitContext,
} from "../../org";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

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
 * Accredited-scope (CMC) lines — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14.
 * Unit-scoped like environmental limits: Cgcre accredits each laboratory site
 * with its own scope. Writes are restricted to unit operational-settings
 * managers and leave an append-only audit trail. The org-level enforcement mode
 * is the exception: it needs the organization `settings:update` permission.
 */
const PREFIX = "/api/accredited-scope";

export const accreditedScopeRouter = createRouter<{
  Variables: AuthVariables;
}>();

const labMiddleware = [...requireLabProtected, requireOrgType("LAB")];

mount(
  accreditedScopeRouter,
  PREFIX,
  accreditedScopeEndpoints.list,
  labMiddleware,
  async (c) => {
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

      return {
        lines,
        unit,
        // The EFFECTIVE mode; a lab that never chose gets the default.
        enforcementMode: resolveScopeEnforcementMode({
          stored: org?.scopeEnforcementMode,
          accreditationActive: org?.accreditationActive,
        }),
        enforcementModeIsDefault: !org?.scopeEnforcementMode,
      };
    });
  },
);

mount(
  accreditedScopeRouter,
  PREFIX,
  accreditedScopeEndpoints.setEnforcementMode,
  [
    ...labMiddleware,
    // organization.scopeEnforcementMode governs EVERY unit's accredited
    // approvals, so it is an organization-level settings write (owner/admin).
    // A single-unit unit_admin must not be able to relax it org-wide.
    requirePermission({ settings: ["update"] }),
  ],
  async (c, { body: input }) => {
    const memberData = c.get("member");

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const [before] = await ctx.o
        .select({
          scopeEnforcementMode: organization.scopeEnforcementMode,
          accreditationActive: organization.accreditationActive,
        })
        .from(organization)
        .where(eq(organization.id, memberData.organizationId))
        .limit(1);

      // What was in force (for a lab that never chose, the default),
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
      await ctx.o
        .update(organization)
        .set({ scopeEnforcementMode: input.mode })
        .where(eq(organization.id, memberData.organizationId));

      // Audited whenever the effective mode changes, or a default becomes an
      // explicit choice (the record that the lab chose, and by whom).
      if (
        before &&
        (effectiveBefore !== input.mode || !before.scopeEnforcementMode)
      ) {
        // Not a line's audit entry (`scopeLineId` is null: the change is
        // the organization's), so it stays off `ctx.audit`.
        await ctx.o.insert(accreditedScopeLineAuditLog).values({
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
          performedBy: ctx.actor.userId,
          ipAddress: ctx.actor.ipAddress,
        });
        // Also on the compliance trail the accreditation profile uses.
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
            performedBy: ctx.actor.userId,
            ipAddress: c.req.header("x-forwarded-for") || null,
          },
          ctx.o,
        );
      }
    });

    return {
      message:
        input.mode === "enforce"
          ? "Guarda de escopo ativada: violações bloqueiam a emissão acreditada"
          : "Guarda de escopo em modo aviso",
      enforcementMode: input.mode,
    };
  },
);

// ===========================================================================
// PUT / - Create or update a scope line (id present = update)
// ===========================================================================
mount(
  accreditedScopeRouter,
  PREFIX,
  accreditedScopeEndpoints.save,
  labMiddleware,
  async (c, { body: input }) => {
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
      throw invalid(
        "scope_line_unit_mismatch",
        "Unidades incompatíveis com a grandeza da linha",
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

    return await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        if (input.id != null) {
          const [existing] = await ctx.o
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
            throw notFound(
              "scope_line_not_found",
              "Linha de escopo não encontrada",
            );
          }

          const [updated] = await ctx.o
            .update(accreditedScopeLine)
            .set({
              ...values,
              // Omitted on the wire = preserve; the web dialog has no k field.
              coverageFactor: input.coverageFactor ?? existing.coverageFactor,
            })
            .where(eq(accreditedScopeLine.id, existing.id))
            .returning();

          // `existing` was read in this transaction, so the update returns it.
          if (!updated) {
            throw notFound(
              "scope_line_not_found",
              "Linha de escopo não encontrada",
            );
          }
          await ctx.audit("accreditedScopeLine", existing.id, {
            action: "update",
            changes: diffScopeLine(existing, updated),
          });

          return {
            message: "Linha de escopo atualizada",
            data: updated,
            unit,
          };
        }

        const [created] = await ctx.o
          .insert(accreditedScopeLine)
          .values({
            organizationId: memberData.organizationId,
            unitId: unit.unitId,
            ...values,
            coverageFactor: input.coverageFactor ?? 2,
          })
          .returning();

        if (!created) throw new Error("Falha ao criar linha de escopo");
        await ctx.audit("accreditedScopeLine", created.id, {
          action: "create",
          changes: null,
        });

        return {
          message: "Linha de escopo adicionada",
          data: created,
          unit,
        };
      },
    );
  },
);

// ===========================================================================
// DELETE /:id - Remove a scope line (audit row survives, soft reference)
// ===========================================================================
mount(
  accreditedScopeRouter,
  PREFIX,
  accreditedScopeEndpoints.delete,
  labMiddleware,
  async (c, { params }) => {
    const memberData = c.get("member");
    const { id } = params;
    requireUnitOperationalSettingsManager(memberData);
    const unit = resolveAccessibleUnitContext(memberData);

    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const [deleted] = await ctx.o
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
        throw notFound(
          "scope_line_not_found",
          "Linha de escopo não encontrada",
        );
      }

      await ctx.audit("accreditedScopeLine", deleted.id, {
        action: "delete",
        changes: null,
      });
    });
    return { message: "Linha de escopo removida" };
  },
);
