import type {
  AccreditedScopeLine,
  AccreditedScopeResponse,
} from "./accredited-scope";

/**
 * Contract-valid example payloads for the accredited-scope endpoints, for tests
 * in any package. `accredited-scope.test.ts` parses every builder against its
 * response schema.
 */

export function buildAccreditedScopeLine(
  overrides: Partial<AccreditedScopeLine> = {},
): AccreditedScopeLine {
  return {
    id: 1,
    unitId: 1,
    quantityKind: "mass",
    rangeMin: 0,
    rangeMax: 100,
    rangeUnit: "g",
    cmcType: "fixed",
    cmcA: 0.5,
    cmcB: null,
    cmcUnit: "mg",
    coverageFactor: 2,
    description: "Balanças classe II",
    validFrom: null,
    validUntil: null,
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

export function buildAccreditedScopeResponse(
  overrides: Partial<AccreditedScopeResponse> = {},
): AccreditedScopeResponse {
  return {
    lines: [buildAccreditedScopeLine()],
    unit: { unitId: 1, unitName: "Matriz" },
    enforcementMode: "warn",
    enforcementModeIsDefault: true,
    ...overrides,
  };
}
