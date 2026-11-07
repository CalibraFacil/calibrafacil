import type { CorrectiveActionRow } from "./capa";

/**
 * Contract-valid example payloads for the CAPA endpoints, for tests in any
 * package. `capa.test.ts` parses every builder against its response schema.
 */

export function buildCorrectiveActionRow(
  overrides: Partial<CorrectiveActionRow> = {},
): CorrectiveActionRow {
  return {
    id: 1,
    capaNumber: "CAPA-2026-001",
    organizationId: "org-1",
    source: "nc_detection",
    sourceReference: null,
    title: "Desvio de calibração",
    description: "Desvio recorrente na calibração de manômetros",
    detectionDate: "2026-05-20T12:00:00.000Z",
    type: "corrective",
    severity: "major",
    category: "method",
    rootCauseAnalysis: null,
    rootCauseAnalysisMethod: null,
    actionPlan: "Revisar o procedimento de calibração",
    preventiveMeasures: null,
    responsibleId: "user-1",
    dueDate: "2026-06-20T12:00:00.000Z",
    implementationEvidence: null,
    implementedAt: null,
    investigationCompletedAt: null,
    verifiedAt: null,
    verifiedBy: null,
    verificationNotes: null,
    effectivenessConfirmed: null,
    verificationIndependence: null,
    verificationIndependenceJustification: null,
    status: "OPEN",
    closedAt: null,
    closedBy: null,
    createdBy: "user-1",
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z",
    ...overrides,
  };
}
