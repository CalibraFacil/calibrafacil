import { accreditedScopeEndpoints } from "./accredited-scope";
import { publicInvitationEndpoints } from "./public-invitations";
import { publicSignupEndpoints } from "./public-signup";
import { assetTypeEndpoints } from "./asset-types";
import { assetEndpoints } from "./assets";
import { calibrationRequestEndpoints } from "./calibration-requests";
import { capaEndpoints } from "./capa";
import { certificateNumberingEndpoints } from "./certificate-numbering";
import { competenceEndpoints } from "./competences";
import { customerGroupEndpoints } from "./customer-groups";
import { customerEndpoints } from "./customers";
import { dashboardEndpoints } from "./dashboard";
import { entityLabelEndpoints } from "./entity-labels";
import { environmentalLimitEndpoints } from "./environmental-limits";
import { financeEndpoints } from "./finance";
import { materialEndpoints } from "./materials";
import { methodEndpoints } from "./methods";
import { nonConformanceEndpoints } from "./non-conformances";
import { portalDomainEndpoints } from "./portal-domains";
import { jobEndpoints } from "./jobs";
import { proficiencyTestEndpoints } from "./proficiency-tests";
import { reportEndpoints } from "./reports";
import { serviceOrderEndpoints } from "./service-orders";
import { serviceEndpoints } from "./services";
import type { EndpointGroup, EndpointPaths } from "./define";
import { signatureEndpoints } from "./signatures";
import { signingCertificateEndpoints } from "./signing-certificates";
import { spcEndpoints } from "./spc";
import { ssoEndpoints } from "./sso";
import { standardEndpoints } from "./standards";
import { trainingRecordEndpoints } from "./training-records";
import { unitEndpoints } from "./units";
import { visitEndpoints } from "./visits";

export * from "./define";
export * from "./public-invitations";
export * from "./public-signup";
export * from "./signing-certificates";
export * from "./sso";
export * from "./portal-domains";
export * from "./assets";
export * from "./asset-types";
export * from "./customer-groups";
export * from "./customers";
export * from "./capa";
export * from "./non-conformances";
export * from "./methods";
export * from "./spc";
export * from "./finance";
export * from "./service-orders";
export * from "./jobs";
export * from "./dashboard";
export * from "./entity-labels";
export * from "./reports";
export * from "./standards";
export * from "./services";
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
export * from "./units";

/**
 * Every converted domain, keyed by its `CalibraApi` namespace. This is the one
 * list the `AppType` route paths, the policy registry, the desktop stubs and the
 * route-drift spec read; converting a domain adds its group here.
 */
export const ENDPOINT_GROUPS = {
  assets: assetEndpoints,
  assetTypes: assetTypeEndpoints,
  customerGroups: customerGroupEndpoints,
  customers: customerEndpoints,
  methods: methodEndpoints,
  nonConformances: nonConformanceEndpoints,
  capas: capaEndpoints,
  spc: spcEndpoints,
  finance: financeEndpoints,
  serviceOrders: serviceOrderEndpoints,
  jobs: jobEndpoints,
  dashboard: dashboardEndpoints,
  entityLabels: entityLabelEndpoints,
  reports: reportEndpoints,
  standards: standardEndpoints,
  services: serviceEndpoints,
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
  portalDomains: portalDomainEndpoints,
  sso: ssoEndpoints,
  signingCertificates: signingCertificateEndpoints,
  publicSignup: publicSignupEndpoints,
  publicInvitations: publicInvitationEndpoints,
  units: unitEndpoints,
} as const satisfies Record<string, EndpointGroup>;

export type EndpointGroups = typeof ENDPOINT_GROUPS;
export type EndpointGroupPaths = EndpointPaths<EndpointGroups>;
