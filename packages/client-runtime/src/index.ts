import type { CalibraApi } from "./types";
import {
  createRawCloudClient,
  type CreateCloudApiClientOptions,
} from "./transport/cloud";
import { createCloudEndpointTransport } from "./transport/endpoint-client";
import type { CreateDesktopHybridApiClientOptions } from "./transport/desktop";
import {
  composeDesktopHybridApi,
  createDesktopApiClient,
  createDesktopBackgroundSyncRequester,
} from "./transport/desktop-client";
import { createAccessApi } from "./modules/access";
import { createApiKeysApi } from "./modules/api-keys";
import { createOrganizationLifecycleApi } from "./modules/organization-lifecycle";
import { createOrganizationProfileApi } from "./modules/organization-profile";
import { createAssetsApi } from "./modules/assets";
import { createAssetTypesApi } from "./modules/asset-types";
import { createCloudAttachmentsApi } from "./modules/attachments";
import { createCloudSyncApi } from "./modules/sync";
import { createOnboardingApi } from "./modules/onboarding";
import { createCalibrationRequestsApi } from "./modules/calibration-requests";
import { createVisitsApi } from "./modules/visits";
import { createCapasApi } from "./modules/capa";
import { createProficiencyTestsApi } from "./modules/proficiency-tests";
import { createSpcApi } from "./modules/spc";
import { createCertificateNumberingApi } from "./modules/certificate-numbering";
import { createCompetencesApi } from "./modules/competences";
import { createCustomersApi } from "./modules/customers";
import { createCustomerGroupsApi } from "./modules/customer-groups";
import { createDashboardApi } from "./modules/dashboard";
import { createEntityLabelsApi } from "./modules/entity-labels";
import { createAccreditedScopeApi } from "./modules/accredited-scope";
import { createEnvironmentalLimitsApi } from "./modules/environmental-limits";
import { createFinanceApi } from "./modules/finance";
import { createIntegrationsApi } from "./modules/integrations";
import { createJobsApi } from "./modules/jobs";
import { createLabSetupApi } from "./modules/lab-setup";
import { createMethodsApi } from "./modules/methods";
import { createNotificationsApi } from "./modules/notifications";
import { createNonConformancesApi } from "./modules/non-conformances";
import { createOrganizationMediaApi } from "./modules/organization-media";
import { createPortalDomainsApi } from "./modules/portal-domains";
import { createEmailDomainsApi } from "./modules/email-domains";
import { createProfileMediaApi } from "./modules/profile-media";
import { createPublicInvitationsApi } from "./modules/public-invitations";
import { createPublicSignupApi } from "./modules/public-signup";
import { createReportsApi } from "./modules/reports";
import { createSessionsApi } from "./modules/sessions";
import { createServiceOrdersApi } from "./modules/service-orders";
import { createMaterialsApi } from "./modules/materials";
import { createServicesApi } from "./modules/services";
import { createSignaturesApi } from "./modules/signatures";
import { createSigningCertificatesApi } from "./modules/signing-certificates";
import { createSsoApi } from "./modules/sso";
import { createStandardsApi } from "./modules/standards";
import { createTrainingRecordsApi } from "./modules/training-records";
import { createUnitsApi } from "./modules/units";

export type { CreateCloudApiClientOptions } from "./transport/cloud";
export type { CreateDesktopHybridApiClientOptions } from "./transport/desktop";
export { isDesktopRuntime } from "./transport/desktop";
export { createDesktopApiClient } from "./transport/desktop-client";

export * from "./types";
export * from "./data-policy";
export * from "./availability";
export function createCloudApiClient(
  options: CreateCloudApiClientOptions,
): CalibraApi {
  const endpointTransport = createCloudEndpointTransport(options);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the raw Hono client type is narrowed to the browser-supported route subset used by runtime modules.
  const rawCloudClient = createRawCloudClient(options) as unknown as {
    api: {
      integrations: {
        $get(): Promise<Response>;
        $post(input: { json: unknown }): Promise<Response>;
        ":id": {
          $put(input: {
            param: { id: string };
            json: unknown;
          }): Promise<Response>;
          validate: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          toggle: {
            $post(input: {
              param: { id: string };
              json: { enabled: boolean };
            }): Promise<Response>;
          };
          sync: {
            $post(input: {
              param: { id: string };
              json: unknown;
            }): Promise<Response>;
            preview: {
              $post(input: {
                param: { id: string };
                json: unknown;
              }): Promise<Response>;
            };
          };
          schedule: {
            $post(input: {
              param: { id: string };
              json: unknown;
            }): Promise<Response>;
          };
          runs: {
            ":runId": {
              retry: {
                $post(input: {
                  param: { id: string; runId: string };
                }): Promise<Response>;
              };
            };
          };
        };
      };
    };
  };

  return {
    dashboard: createDashboardApi(endpointTransport, options),
    units: createUnitsApi(endpointTransport, options),
    access: createAccessApi(endpointTransport, options),
    onboarding: createOnboardingApi(endpointTransport, options),
    sessions: createSessionsApi(endpointTransport, options),
    finance: createFinanceApi(endpointTransport, options),
    sso: createSsoApi(endpointTransport, options),
    apiKeys: createApiKeysApi(endpointTransport, options),
    organizationLifecycle: createOrganizationLifecycleApi(
      endpointTransport,
      options,
    ),
    organizationProfile: createOrganizationProfileApi(
      endpointTransport,
      options,
    ),
    entityLabels: createEntityLabelsApi(endpointTransport, options),
    certificateNumbering: createCertificateNumberingApi(
      endpointTransport,
      options,
    ),
    portalDomains: createPortalDomainsApi(endpointTransport, options),
    emailDomains: createEmailDomainsApi(endpointTransport, options),
    notifications: createNotificationsApi(endpointTransport, options),
    signatures: createSignaturesApi(endpointTransport, options),
    profileMedia: createProfileMediaApi(endpointTransport, options),
    organizationMedia: createOrganizationMediaApi(endpointTransport, options),
    signingCertificates: createSigningCertificatesApi(
      endpointTransport,
      options,
    ),
    customers: createCustomersApi(endpointTransport, options),
    customerGroups: createCustomerGroupsApi(endpointTransport, options),
    assets: createAssetsApi(endpointTransport, options),
    assetTypes: createAssetTypesApi(endpointTransport, options),
    environmentalLimits: createEnvironmentalLimitsApi(
      endpointTransport,
      options,
    ),
    accreditedScope: createAccreditedScopeApi(endpointTransport, options),
    integrations: createIntegrationsApi(rawCloudClient),
    services: createServicesApi(endpointTransport, options),
    materials: createMaterialsApi(endpointTransport, options),
    methods: createMethodsApi(endpointTransport, options),
    standards: createStandardsApi(endpointTransport, options),
    jobs: createJobsApi(endpointTransport, options),
    serviceOrders: createServiceOrdersApi(endpointTransport, options),
    sync: createCloudSyncApi(),
    attachments: createCloudAttachmentsApi(),
    reports: createReportsApi(endpointTransport, options),
    publicInvitations: createPublicInvitationsApi(endpointTransport, options),
    publicSignup: createPublicSignupApi(endpointTransport, options),
    labSetup: createLabSetupApi(endpointTransport, options),
    nonConformances: createNonConformancesApi(endpointTransport, options),
    capas: createCapasApi(endpointTransport, options),
    proficiencyTests: createProficiencyTestsApi(endpointTransport, options),
    spc: createSpcApi(endpointTransport, options),
    competences: createCompetencesApi(endpointTransport, options),
    trainingRecords: createTrainingRecordsApi(endpointTransport, options),
    calibrationRequests: createCalibrationRequestsApi(
      endpointTransport,
      options,
    ),
    visits: createVisitsApi(endpointTransport, options),
  };
}

export function createDesktopHybridApiClient(
  options: CreateDesktopHybridApiClientOptions,
): CalibraApi {
  const cloud = createCloudApiClient(options.cloud);
  const local = createDesktopApiClient(options.local);
  const requestBackgroundSync = createDesktopBackgroundSyncRequester(
    options.local,
  );

  // All cloud-vs-local routing is derived from calibraApiPolicyRegistry —
  // change a method's policy there and the hybrid client reroutes with it.
  return composeDesktopHybridApi(cloud, local, requestBackgroundSync);
}
