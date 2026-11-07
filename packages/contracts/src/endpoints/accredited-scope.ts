import { z } from "zod";
import {
  AccreditedScopeLineSchema,
  CmcTypeSchema,
} from "@calibra-facil/schemas";

import { nullableNumber, nullableString, unitContextSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The laboratory's accredited scope (CMC lines, ISO/IEC 17025 7.6 and 7.8.3,
 * ILAC P14) and the organization's scope-guard mode. Response schemas are wire
 * schemas written from what `apps/api/src/domains/quality/routes/accredited-scope.ts` returns.
 * The whole domain is managed on the cloud-only settings surface.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** One scope line (`accredited_scope_line`; the audit columns ride along). */
const accreditedScopeLineSchema = z.object({
  id: z.number(),
  unitId: z.number(),
  quantityKind: z.string(),
  rangeMin: z.number(),
  rangeMax: z.number(),
  rangeUnit: z.string(),
  cmcType: CmcTypeSchema,
  cmcA: z.number(),
  cmcB: nullableNumber,
  cmcUnit: z.string(),
  coverageFactor: z.number(),
  description: nullableString,
  validFrom: nullableString,
  validUntil: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccreditedScopeLine = z.infer<typeof accreditedScopeLineSchema>;

/** Org-level guard: `warn` reports a violation, `enforce` blocks the accredited issue. */
const scopeEnforcementModeSchema = z.enum(["warn", "enforce"]);
export type ScopeEnforcementMode = z.infer<typeof scopeEnforcementModeSchema>;

/** GET /api/accredited-scope */
export const accreditedScopeResponseSchema = z.object({
  lines: z.array(accreditedScopeLineSchema),
  unit: unitContextSchema,
  /** The EFFECTIVE mode: a lab that never chose gets the default. */
  enforcementMode: scopeEnforcementModeSchema,
  /**
   * True when the lab never chose a mode and the default applies (`enforce` for
   * an accredited lab, `warn` otherwise); false when the mode was set explicitly.
   */
  enforcementModeIsDefault: z.boolean(),
});
export type AccreditedScopeResponse = z.infer<
  typeof accreditedScopeResponseSchema
>;

/** PUT /api/accredited-scope: the stored line (created or updated). */
export const saveAccreditedScopeLineResponseSchema = z.object({
  message: z.string(),
  data: accreditedScopeLineSchema,
  unit: unitContextSchema,
});
export type SaveAccreditedScopeLineResponse = z.infer<
  typeof saveAccreditedScopeLineResponseSchema
>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// Managed on the cloud-only settings surface and enforced
// server-side at submit/approve; nothing consumes scope lines on the desktop
// yet, so the whole group stays cloud-only until the offline execution
// warning lands.
const DESKTOP_LABEL = "Escopo acreditado (CMC)";

export const accreditedScopeEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/accredited-scope",
    response: accreditedScopeResponseSchema,
    failure: "Falha ao carregar o escopo acreditado",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  save: endpoint({
    method: "put",
    path: "/api/accredited-scope",
    body: AccreditedScopeLineSchema,
    response: saveAccreditedScopeLineResponseSchema,
    failure: "Falha ao salvar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  delete: endpoint({
    method: "delete",
    path: "/api/accredited-scope/:id",
    params: z.object({ id: routeId }),
    response: z.object({ message: z.string() }),
    failure: "Falha ao remover",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  setEnforcementMode: endpoint({
    method: "put",
    path: "/api/accredited-scope/enforcement",
    body: z.object({ mode: scopeEnforcementModeSchema }),
    response: z.object({
      message: z.string(),
      enforcementMode: scopeEnforcementModeSchema,
    }),
    failure: "Falha ao alterar o modo da guarda de escopo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
