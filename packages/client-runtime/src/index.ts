import type {
  CalibraApi,
  CreateApiKeyInput,
  CreateAssetInput,
  CreateCustomerInput,
  CreateJobInput,
  CreateServiceInput,
  CreateServiceOrderInput,
  CreateServiceOrderQuoteInput,
  CreateSsoProviderInput,
  DeliverServiceOrderInput,
  IssueServiceOrderDeliveryDocumentInput,
  JobExecutionPayload,
  JobsListStatus,
  MethodCompileDraftInput,
  MethodPreviewDraftInput,
  MethodPublishDraftInput,
  MethodRequestApprovalInput,
  MethodWriteInput,
  SaveEnvironmentalLimitInput,
  SaveServiceOrderEvaluationInput,
  SaveServiceOrderExecutionInput,
  SendServiceOrderQuoteInput,
  ServiceOrderRepairSealInput,
  StandardWriteInput,
  StartSsoInput,
  UpdateAssetInput,
  UpdateCertificateNumberingProfileInput,
  UpdateCustomerComplianceInput,
  UpdateCustomerInput,
  UpdateNotificationPreferencesInput,
  UpdateServiceInput,
  UploadSigningCertificateInput,
} from "./types";
import {
  createRawCloudClient,
  type CreateCloudApiClientOptions,
} from "./transport/cloud";
import type { CreateDesktopHybridApiClientOptions } from "./transport/desktop";
import {
  createDesktopApiClient,
  createDesktopBackgroundSyncRequester,
  withDesktopLocalFirstReadThroughSync,
} from "./transport/desktop-client";
import { createAccessApi } from "./modules/access";
import { createApiKeysApi } from "./modules/api-keys";
import { createAssetsApi } from "./modules/assets";
import { createAssetTypesApi } from "./modules/asset-types";
import { createCloudAttachmentsApi } from "./modules/attachments";
import { createCloudSyncApi } from "./modules/sync";
import { createBackofficeApi } from "./modules/backoffice";
import { createBillingApi } from "./modules/billing";
import { createCalibrationRequestsApi } from "./modules/calibration-requests";
import { createCapasApi } from "./modules/capa";
import { createCertificateNumberingApi } from "./modules/certificate-numbering";
import { createCertificateTemplatesApi } from "./modules/certificate-templates";
import { createCompetencesApi } from "./modules/competences";
import { createCustomerSuccessApi } from "./modules/customer-success";
import { createCustomersApi } from "./modules/customers";
import { createCustomerGroupsApi } from "./modules/customer-groups";
import { createDashboardApi } from "./modules/dashboard";
import { createEntityLabelsApi } from "./modules/entity-labels";
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
import { createProfileMediaApi } from "./modules/profile-media";
import { createPublicCheckoutApi } from "./modules/public-checkout";
import { createPublicInvitationsApi } from "./modules/public-invitations";
import { createReportsApi } from "./modules/reports";
import { createSessionsApi } from "./modules/sessions";
import { createServiceOrdersApi } from "./modules/service-orders";
import { createServicesApi } from "./modules/services";
import { createSignaturesApi } from "./modules/signatures";
import { createSigningCertificatesApi } from "./modules/signing-certificates";
import { createSsoApi } from "./modules/sso";
import { createStandardsApi } from "./modules/standards";
import { createTrainingRecordsApi } from "./modules/training-records";
import { createUnitsApi } from "./modules/units";

export type {
  ActiveUnitProvider,
  CreateCloudApiClientOptions,
  HonoCloudClient,
} from "./transport/cloud";
export { CalibraApiError } from "./transport/errors";
export { createRawCloudClient, readJsonResponse } from "./transport";
export type {
  CreateDesktopApiClientOptions,
  CreateDesktopHybridApiClientOptions,
} from "./transport/desktop";
export { getDesktopApiBaseUrl, isDesktopRuntime } from "./transport/desktop";
export { createDesktopApiClient } from "./transport/desktop-client";

export * from "./types";
export * from "./data-policy";
export function createCloudApiClient(
  options: CreateCloudApiClientOptions,
): CalibraApi {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the raw Hono client type is narrowed to the browser-supported route subset used by runtime modules.
  const rawCloudClient = createRawCloudClient(options) as unknown as {
    api: {
      dashboard: {
        stats: {
          $get(): Promise<Response>;
        };
      };
      billing: {
        access: {
          $get(): Promise<Response>;
        };
        subscription: {
          $get(): Promise<Response>;
        };
        payments: {
          $get(input: {
            query: {
              limit?: string;
              offset?: string;
            };
          }): Promise<Response>;
        };
      };
      finance: {
        access: {
          $get(): Promise<Response>;
        };
      };
      sessions: {
        revoke: {
          $post(input: { json: { sessionId: string } }): Promise<Response>;
        };
      };
      "lab-setup": {
        ":token": {
          $get(input: { param: { token: string } }): Promise<Response>;
          complete: {
            $post(input: { param: { token: string } }): Promise<Response>;
          };
          "request-magic-link": {
            $post(input: { param: { token: string } }): Promise<Response>;
          };
          "request-otp": {
            $post(input: { param: { token: string } }): Promise<Response>;
          };
        };
      };
      backoffice: {
        access: {
          $get(): Promise<Response>;
        };
        impersonation: {
          stop: {
            $post(): Promise<Response>;
          };
        };
      };
      sso: {
        start: {
          $post(input: { json: StartSsoInput }): Promise<Response>;
        };
        providers: {
          $get(): Promise<Response>;
          $post(input: { json: CreateSsoProviderInput }): Promise<Response>;
          ":providerId": {
            $delete(input: {
              param: { providerId: string };
            }): Promise<Response>;
            "request-domain-verification": {
              $post(input: {
                param: { providerId: string };
              }): Promise<Response>;
            };
            "verify-domain": {
              $post(input: {
                param: { providerId: string };
              }): Promise<Response>;
            };
          };
        };
      };
      "api-keys": {
        $get(): Promise<Response>;
        $post(input: { json: CreateApiKeyInput }): Promise<Response>;
        ":id": {
          rotate: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          revoke: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      nc: {
        ":id": {
          label: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      capa: {
        ":id": {
          label: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      competences: {
        ":id": {
          label: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      "certificate-numbering": {
        $get(): Promise<Response>;
        $put(input: {
          json: UpdateCertificateNumberingProfileInput;
        }): Promise<Response>;
      };
      "portal-domains": {
        $get(): Promise<Response>;
        $post(input: { json: { hostname: string } }): Promise<Response>;
        $delete(): Promise<Response>;
        verify: {
          $post(): Promise<Response>;
        };
        activate: {
          $post(): Promise<Response>;
        };
      };
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
      notifications: {
        $get(input: {
          query: {
            page: string;
            limit: string;
          };
        }): Promise<Response>;
        "unread-count": {
          $get(): Promise<Response>;
        };
        "mark-read": {
          $post(input: {
            json: { notificationIds: number[] };
          }): Promise<Response>;
        };
        "mark-all-read": {
          $post(): Promise<Response>;
        };
        preferences: {
          $get(): Promise<Response>;
          $put(input: {
            json: UpdateNotificationPreferencesInput;
          }): Promise<Response>;
        };
      };
      signatures: {
        "my-signature": {
          $get(): Promise<Response>;
          $delete(): Promise<Response>;
        };
      };
      signing: {
        certificates: {
          $get(): Promise<Response>;
          $post(input: {
            json: UploadSigningCertificateInput;
          }): Promise<Response>;
          ":id": {
            $delete(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
            "set-default": {
              $post(input: { param: { id: string } }): Promise<Response>;
            };
          };
        };
      };
      units: {
        $get(): Promise<Response>;
        admin: {
          units: {
            $get(): Promise<Response>;
            $post(input: { json: { name: string } }): Promise<Response>;
            ":id": {
              $patch(input: {
                param: { id: string };
                json: { name?: string; status?: "ACTIVE" | "ARCHIVED" };
              }): Promise<Response>;
            };
          };
          members: {
            $get(): Promise<Response>;
            ":memberId": {
              assignments: {
                $put(input: {
                  param: { memberId: string };
                  json: {
                    assignments: Array<{
                      unitId: number;
                      role: "member" | "technician" | "unit_admin";
                    }>;
                  };
                }): Promise<Response>;
              };
              role: {
                $patch(input: {
                  param: { memberId: string };
                  json: { role: string };
                }): Promise<Response>;
              };
            };
          };
          activity: {
            $get(): Promise<Response>;
          };
        };
      };
      jobs: {
        $post(input: { json: CreateJobInput }): Promise<Response>;
        $get(input: {
          query: {
            page: string;
            limit: string;
            customerId?: string;
            query?: string;
            status?: JobsListStatus;
          };
        }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $delete(input: {
            param: { id: string };
            json: { reason: string };
          }): Promise<Response>;
          approve: {
            $post(input: {
              param: { id: string };
              json: { reason: string; environmentalJustification?: string };
            }): Promise<Response>;
          };
          reject: {
            $post(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
          };
          assign: {
            $post(input: {
              param: { id: string };
              json: { technicianId: string };
            }): Promise<Response>;
          };
          download: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          "generate-label": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "download-label": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          amend: {
            $post(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
          };
          execute: {
            $post(input: {
              param: { id: string };
              json: JobExecutionPayload;
            }): Promise<Response>;
          };
          submit: {
            $post(input: {
              param: { id: string };
              json: JobExecutionPayload;
            }): Promise<Response>;
          };
        };
        technicians: {
          list: {
            $get(): Promise<Response>;
          };
        };
      };
      services: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            query?: string;
            assetTypeId?: string;
            methodId?: string;
            isActive?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateServiceInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: UpdateServiceInput;
          }): Promise<Response>;
          $delete(input: { param: { id: string } }): Promise<Response>;
          "audit-log": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      methods: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            status?: string;
            assetTypeId?: string;
            query?: string;
            includeArchived?: string;
          };
        }): Promise<Response>;
        $post(input: { json: MethodWriteInput }): Promise<Response>;
        compile: {
          $post(input: { json: MethodCompileDraftInput }): Promise<Response>;
        };
        preview: {
          $post(input: { json: MethodPreviewDraftInput }): Promise<Response>;
        };
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: MethodWriteInput;
          }): Promise<Response>;
          audit: {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          archive: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "new-version": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "technical-review": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "quality-approve": {
            $post(input: {
              param: { id: string };
              json: MethodWriteInput;
            }): Promise<Response>;
          };
          "return-to-draft": {
            $post(input: {
              param: { id: string };
              json: { reason: string };
            }): Promise<Response>;
          };
          publish: {
            $post(input: {
              param: { id: string };
              json: MethodPublishDraftInput;
            }): Promise<Response>;
          };
          "request-approval": {
            $post(input: {
              param: { id: string };
              json: MethodRequestApprovalInput;
            }): Promise<Response>;
          };
        };
      };
      standards: {
        $get(input: {
          query: {
            page?: string;
            status?: string;
            query?: string;
            limit?: string;
          };
        }): Promise<Response>;
        $post(input: { json: StandardWriteInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: StandardWriteInput;
          }): Promise<Response>;
          $delete(input: { param: { id: string } }): Promise<Response>;
          "audit-log": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          renew: {
            $post(input: {
              param: { id: string };
              json: StandardWriteInput;
            }): Promise<Response>;
          };
        };
      };
      "environmental-limits": {
        $get(): Promise<Response>;
        $put(input: { json: SaveEnvironmentalLimitInput }): Promise<Response>;
        ":id": {
          $delete(input: { param: { id: string } }): Promise<Response>;
        };
        effective: {
          ":assetTypeId": {
            $get(input: {
              param: { assetTypeId: string };
              query?: { unitId?: string };
            }): Promise<Response>;
          };
        };
      };
      customers: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            query?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateCustomerInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: UpdateCustomerInput;
          }): Promise<Response>;
          "audit-log": {
            $get(input: {
              param: { id: string };
              query: { page: string; limit: string };
            }): Promise<Response>;
          };
          compliance: {
            $put(input: {
              param: { id: string };
              json: UpdateCustomerComplianceInput;
            }): Promise<Response>;
          };
          members: {
            $get(input: { param: { id: string } }): Promise<Response>;
            ":memberId": {
              $delete(input: {
                param: { id: string; memberId: string };
              }): Promise<Response>;
            };
          };
          invitations: {
            $get(input: { param: { id: string } }): Promise<Response>;
            $post(input: {
              param: { id: string };
              json: { email: string; role: string };
            }): Promise<Response>;
            ":invId": {
              $delete(input: {
                param: { id: string; invId: string };
              }): Promise<Response>;
              resend: {
                $post(input: {
                  param: { id: string; invId: string };
                }): Promise<Response>;
              };
            };
          };
        };
      };
      assets: {
        $get(input: {
          query: {
            page?: string;
            limit?: string;
            customerId?: string;
            status?: string;
            query?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateAssetInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          $put(input: {
            param: { id: string };
            json: UpdateAssetInput;
          }): Promise<Response>;
          "audit-log": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
      "asset-types": {
        $get(input: { query?: Record<string, string> }): Promise<Response>;
      };
      "service-orders": {
        $get(input: {
          query: {
            page: string;
            limit: string;
            query?: string;
            status?: string;
          };
        }): Promise<Response>;
        $post(input: { json: CreateServiceOrderInput }): Promise<Response>;
        ":id": {
          $get(input: { param: { id: string } }): Promise<Response>;
          evaluations: {
            $post(input: {
              param: { id: string };
              json: SaveServiceOrderEvaluationInput;
            }): Promise<Response>;
            ":evaluationId": {
              $patch(input: {
                param: { id: string; evaluationId: string };
                json: SaveServiceOrderEvaluationInput;
              }): Promise<Response>;
            };
          };
          quotes: {
            $post(input: {
              param: { id: string };
              json: CreateServiceOrderQuoteInput;
            }): Promise<Response>;
            ":quoteId": {
              send: {
                $post(input: {
                  param: { id: string; quoteId: string };
                  json: SendServiceOrderQuoteInput;
                }): Promise<Response>;
              };
            };
          };
          execution: {
            finish: {
              $post(input: {
                param: { id: string };
                json: SaveServiceOrderExecutionInput;
              }): Promise<Response>;
            };
          };
          "intake-document": {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "intake-document.pdf": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          tag: {
            $post(input: { param: { id: string } }): Promise<Response>;
          };
          "tag.pdf": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
          "repair-seal": {
            $patch(input: {
              param: { id: string };
              json: ServiceOrderRepairSealInput;
            }): Promise<Response>;
          };
          deliver: {
            $post(input: {
              param: { id: string };
              json: DeliverServiceOrderInput;
            }): Promise<Response>;
          };
          "delivery-document": {
            $post(input: {
              param: { id: string };
              json: IssueServiceOrderDeliveryDocumentInput;
            }): Promise<Response>;
          };
          "delivery-document.pdf": {
            $get(input: { param: { id: string } }): Promise<Response>;
          };
        };
      };
    };
  };

  return {
    dashboard: createDashboardApi(rawCloudClient),
    units: createUnitsApi(rawCloudClient),
    access: createAccessApi(rawCloudClient),
    sessions: createSessionsApi(rawCloudClient),
    finance: createFinanceApi(rawCloudClient),
    billing: createBillingApi(rawCloudClient),
    backoffice: createBackofficeApi(rawCloudClient),
    sso: createSsoApi(rawCloudClient),
    apiKeys: createApiKeysApi(rawCloudClient),
    entityLabels: createEntityLabelsApi(rawCloudClient),
    certificateNumbering: createCertificateNumberingApi(rawCloudClient),
    portalDomains: createPortalDomainsApi(rawCloudClient),
    notifications: createNotificationsApi(rawCloudClient),
    signatures: createSignaturesApi(rawCloudClient, options),
    profileMedia: createProfileMediaApi(options),
    organizationMedia: createOrganizationMediaApi(options),
    signingCertificates: createSigningCertificatesApi(rawCloudClient),
    customers: createCustomersApi(rawCloudClient),
    customerGroups: createCustomerGroupsApi(rawCloudClient),
    assets: createAssetsApi(rawCloudClient),
    assetTypes: createAssetTypesApi(rawCloudClient),
    environmentalLimits: createEnvironmentalLimitsApi(rawCloudClient),
    integrations: createIntegrationsApi(rawCloudClient),
    services: createServicesApi(rawCloudClient),
    methods: createMethodsApi(rawCloudClient),
    standards: createStandardsApi(rawCloudClient, options),
    jobs: createJobsApi(rawCloudClient),
    serviceOrders: createServiceOrdersApi(rawCloudClient),
    sync: createCloudSyncApi(),
    attachments: createCloudAttachmentsApi(),
    reports: createReportsApi(rawCloudClient),
    publicCheckout: createPublicCheckoutApi(rawCloudClient),
    publicInvitations: createPublicInvitationsApi(rawCloudClient),
    labSetup: createLabSetupApi(rawCloudClient),
    nonConformances: createNonConformancesApi(rawCloudClient),
    capas: createCapasApi(rawCloudClient),
    certificateTemplates: createCertificateTemplatesApi(
      rawCloudClient,
      options,
    ),
    competences: createCompetencesApi(rawCloudClient),
    trainingRecords: createTrainingRecordsApi(rawCloudClient),
    customerSuccess: createCustomerSuccessApi(rawCloudClient),
    calibrationRequests: createCalibrationRequestsApi(rawCloudClient),
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

  return {
    ...cloud,
    dashboard: withDesktopLocalFirstReadThroughSync(
      cloud.dashboard,
      local.dashboard,
      local,
      ["getStats"],
      requestBackgroundSync,
    ),
    customers: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.customers,
        local.customers,
        local,
        ["list", "get"],
        requestBackgroundSync,
      ),
      create: local.customers.create,
      update: local.customers.update,
    },
    assets: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.assets,
        local.assets,
        local,
        ["list", "get"],
        requestBackgroundSync,
      ),
      create: local.assets.create,
      update: local.assets.update,
    },
    assetTypes: withDesktopLocalFirstReadThroughSync(
      cloud.assetTypes,
      local.assetTypes,
      local,
      ["list"],
      requestBackgroundSync,
    ),
    services: withDesktopLocalFirstReadThroughSync(
      cloud.services,
      local.services,
      local,
      ["list", "get"],
      requestBackgroundSync,
    ),
    methods: withDesktopLocalFirstReadThroughSync(
      cloud.methods,
      local.methods,
      local,
      ["list", "get"],
      requestBackgroundSync,
    ),
    standards: withDesktopLocalFirstReadThroughSync(
      cloud.standards,
      local.standards,
      local,
      ["list", "get", "listCompositionProfiles"],
      requestBackgroundSync,
    ),
    environmentalLimits: withDesktopLocalFirstReadThroughSync(
      cloud.environmentalLimits,
      local.environmentalLimits,
      local,
      ["list"],
      requestBackgroundSync,
    ),
    sync: local.sync,
    attachments: local.attachments,
    jobs: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.jobs,
        local.jobs,
        local,
        ["list", "get", "listStandards", "getEffectiveEnvironmentalLimits"],
        requestBackgroundSync,
      ),
      saveExecution: local.jobs.saveExecution,
      submitExecution: local.jobs.submitExecution,
      createCertificateDraft: local.jobs.createCertificateDraft,
    },
    serviceOrders: {
      ...withDesktopLocalFirstReadThroughSync(
        cloud.serviceOrders,
        local.serviceOrders,
        local,
        ["list", "get"],
        requestBackgroundSync,
      ),
      create: local.serviceOrders.create,
      createQuote: local.serviceOrders.createQuote,
      saveExecution: local.serviceOrders.saveExecution,
      issueDeliveryDocument: local.serviceOrders.issueDeliveryDocument,
    },
  };
}
