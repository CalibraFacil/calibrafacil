import { assetEndpoints } from "./assets";
import { calibrationRequestEndpoints } from "./calibration-requests";
import { certificateNumberingEndpoints } from "./certificate-numbering";
import { capaEndpoints } from "./capa";
import { customerEndpoints } from "./customers";
import { dashboardEndpoints } from "./dashboard";
import { competenceEndpoints } from "./competences";
import { nonConformanceEndpoints } from "./non-conformances";
import { proficiencyTestEndpoints } from "./proficiency-tests";
import { spcEndpoints } from "./spc";
import { trainingRecordEndpoints } from "./training-records";
import { accreditedScopeEndpoints } from "./accredited-scope";
import { environmentalLimitEndpoints } from "./environmental-limits";
import { materialEndpoints } from "./materials";
import type { EndpointGroup, EndpointPaths } from "./define";
import { reportEndpoints } from "./reports";
import { signatureEndpoints } from "./signatures";
import { visitEndpoints } from "./visits";

export * from "./define";
export * from "./assets";
export * from "./customers";
export * from "./capa";
export * from "./non-conformances";
export * from "./spc";
export * from "./dashboard";
export * from "./reports";
export * from "./certificate-numbering";
export * from "./competences";
export * from "./proficiency-tests";
export * from "./training-records";
export * from "./signatures";
export * from "./visits";
export * from "./calibration-requests";
export * from "./accredited-scope";
export * from "./environmental-limits";
export * from "./materials";

/**
 * Every converted domain, keyed by its `CalibraApi` namespace. This is the one
 * list the `AppType` route paths, the policy registry, the desktop stubs and the
 * route-drift spec read; converting a domain adds its group here.
 */
export const ENDPOINT_GROUPS = {
  assets: assetEndpoints,
  customers: customerEndpoints,
  nonConformances: nonConformanceEndpoints,
  capas: capaEndpoints,
  spc: spcEndpoints,
  dashboard: dashboardEndpoints,
  reports: reportEndpoints,
  certificateNumbering: certificateNumberingEndpoints,
  competences: competenceEndpoints,
  trainingRecords: trainingRecordEndpoints,
  proficiencyTests: proficiencyTestEndpoints,
  signatures: signatureEndpoints,
  visits: visitEndpoints,
  calibrationRequests: calibrationRequestEndpoints,
  environmentalLimits: environmentalLimitEndpoints,
  accreditedScope: accreditedScopeEndpoints,
  materials: materialEndpoints,
} as const satisfies Record<string, EndpointGroup>;

export type EndpointGroups = typeof ENDPOINT_GROUPS;
export type EndpointGroupPaths = EndpointPaths<EndpointGroups>;
