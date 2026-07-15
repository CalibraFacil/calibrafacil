import { describe, expect, it } from "vitest";

import {
  calibraApiPolicyRegistry,
  createCloudApiClient,
  createDesktopApiClient,
  createDesktopHybridApiClient,
  getCalibraApiDataPolicy,
  getDesktopDataPolicyUnavailableMessage,
  isDesktopRuntime,
  listCalibraApiPolicyEntries,
} from "./index";
import type { CreateServiceOrderInput, JobExecutionPayload } from "./index";

function testWindow(value: unknown): Window {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- tests construct the browser surface needed by desktop runtime detection.
  return value as Window;
}

function testPayload<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- tests intentionally exercise partial command payload transport.
  return value as T;
}

function formDataBody(init: RequestInit | undefined): FormData {
  if (init?.body instanceof FormData) {
    return init.body;
  }

  throw new Error("Expected FormData body");
}

describe("client runtime data policy registry", () => {
  it("documents the current desktop parity boundary", () => {
    expect(getCalibraApiDataPolicy("standards", "list")).toBe(
      "local-first-read-through-sync",
    );
    expect(getCalibraApiDataPolicy("customers", "list")).toBe(
      "local-first-read-through-sync",
    );
    expect(getCalibraApiDataPolicy("jobs", "createCertificateDraft")).toBe(
      "local-only",
    );
    expect(getCalibraApiDataPolicy("sync", "getSession")).toBe("local-only");
    expect(getCalibraApiDataPolicy("billing", "getSubscription")).toBe(
      "cloud-only",
    );
    expect(getCalibraApiDataPolicy("jobs", "saveExecution")).toBe(
      "local-command-sync",
    );
    expect(getCalibraApiDataPolicy("serviceOrders", "create")).toBe(
      "local-command-sync",
    );
    expect(getCalibraApiDataPolicy("serviceOrders", "createQuote")).toBe(
      "local-command-sync",
    );
    expect(getCalibraApiDataPolicy("serviceOrders", "saveExecution")).toBe(
      "local-command-sync",
    );
    expect(
      getCalibraApiDataPolicy("serviceOrders", "issueDeliveryDocument"),
    ).toBe("local-command-sync");
  });

  it("exposes every namespace as policy entries for runtime inspection", () => {
    const entries = listCalibraApiPolicyEntries();
    const namespaces = new Set(entries.map((entry) => entry.namespace));

    expect(entries.length).toBeGreaterThan(0);
    expect(namespaces.size).toBe(Object.keys(calibraApiPolicyRegistry).length);
    expect(entries).toContainEqual({
      namespace: "standards",
      method: "list",
      policy: "local-first-read-through-sync",
    });
  });

  it("enumerates the current policy for every API method", () => {
    expect(listCalibraApiPolicyEntries()).toMatchInlineSnapshot(`
      [
        {
          "method": "getStats",
          "namespace": "dashboard",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "getDashboardUnits",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "listAdminUnits",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "listAdminMembers",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "listAdminActivity",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "createAdminUnit",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "updateAdminUnit",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "updateMemberAssignments",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "updateMemberRole",
          "namespace": "units",
          "policy": "cloud-only",
        },
        {
          "method": "getPlanAccess",
          "namespace": "access",
          "policy": "cloud-only",
        },
        {
          "method": "getFinanceAccess",
          "namespace": "access",
          "policy": "cloud-only",
        },
        {
          "method": "revoke",
          "namespace": "sessions",
          "policy": "cloud-only",
        },
        {
          "method": "getOverview",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listDocuments",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getDocument",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "updateDocument",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "issueDocument",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "voidDocument",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listEligibleJobs",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "createDocument",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listContracts",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getContract",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "createContract",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "activateContract",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "cancelContract",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listReceipts",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "receiveInstallment",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listErpExports",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "exportErpDocument",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listBillingReadiness",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "sendBillingReadiness",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getServiceOrderStatus",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getCustomerTimeline",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getCertificateRelease",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "releaseCertificateByException",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listCertificateReleasePolicies",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "createCertificateReleasePolicy",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "updateCertificateReleasePolicy",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "listAutomaticSendRules",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "createAutomaticSendRule",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "updateAutomaticSendRule",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getOperationsToCash",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getRevenueLeakage",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getCashForecast",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getMarginDashboards",
          "namespace": "finance",
          "policy": "cloud-only",
        },
        {
          "method": "getSubscription",
          "namespace": "billing",
          "policy": "cloud-only",
        },
        {
          "method": "listPayments",
          "namespace": "billing",
          "policy": "cloud-only",
        },
        {
          "method": "getAccess",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "bootstrap",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listOrganizations",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getOrganization",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getSupportQueue",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listUsers",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "updateUserRole",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "banUser",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "unbanUser",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "impersonateUser",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "createUser",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "provisionLab",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "requestUserPasswordReset",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getUser",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listUserSessions",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "revokeUserSession",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listUserActivity",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getPresence",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listAuditLog",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getIntegrationHealth",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getVitals",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listOperatorAlerts",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "recomputeOperatorAlerts",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "acknowledgeOperatorAlert",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listAccountTasks",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "createAccountTask",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "completeAccountTask",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "updateOrganizationLifecycle",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listInteractions",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "createInteraction",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "manageSubscription",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listEntitlementOverrides",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "grantEntitlementOverride",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "revokeEntitlementOverride",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "getOrganizationActivity",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listImportRuns",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "parseImportFile",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "validateImportRun",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "listApprovals",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "createApprovalRequest",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "decideApproval",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "stopImpersonation",
          "namespace": "backoffice",
          "policy": "cloud-only",
        },
        {
          "method": "start",
          "namespace": "sso",
          "policy": "cloud-only",
        },
        {
          "method": "getProviders",
          "namespace": "sso",
          "policy": "cloud-only",
        },
        {
          "method": "createProvider",
          "namespace": "sso",
          "policy": "cloud-only",
        },
        {
          "method": "requestDomainVerification",
          "namespace": "sso",
          "policy": "cloud-only",
        },
        {
          "method": "verifyDomain",
          "namespace": "sso",
          "policy": "cloud-only",
        },
        {
          "method": "deleteProvider",
          "namespace": "sso",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "apiKeys",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "apiKeys",
          "policy": "cloud-only",
        },
        {
          "method": "rotate",
          "namespace": "apiKeys",
          "policy": "cloud-only",
        },
        {
          "method": "revoke",
          "namespace": "apiKeys",
          "policy": "cloud-only",
        },
        {
          "method": "getNonConformance",
          "namespace": "entityLabels",
          "policy": "cloud-only",
        },
        {
          "method": "getCapa",
          "namespace": "entityLabels",
          "policy": "cloud-only",
        },
        {
          "method": "getCompetence",
          "namespace": "entityLabels",
          "policy": "cloud-only",
        },
        {
          "method": "getProfile",
          "namespace": "certificateNumbering",
          "policy": "cloud-only",
        },
        {
          "method": "updateProfile",
          "namespace": "certificateNumbering",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "portalDomains",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "portalDomains",
          "policy": "cloud-only",
        },
        {
          "method": "verify",
          "namespace": "portalDomains",
          "policy": "cloud-only",
        },
        {
          "method": "activate",
          "namespace": "portalDomains",
          "policy": "cloud-only",
        },
        {
          "method": "delete",
          "namespace": "portalDomains",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "validateKey",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "rotateKey",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "verify",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "activate",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "delete",
          "namespace": "emailDomains",
          "policy": "cloud-only",
        },
        {
          "method": "getUnreadCount",
          "namespace": "notifications",
          "policy": "cloud-only",
        },
        {
          "method": "listRecent",
          "namespace": "notifications",
          "policy": "cloud-only",
        },
        {
          "method": "markRead",
          "namespace": "notifications",
          "policy": "cloud-only",
        },
        {
          "method": "markAllRead",
          "namespace": "notifications",
          "policy": "cloud-only",
        },
        {
          "method": "getPreferences",
          "namespace": "notifications",
          "policy": "cloud-only",
        },
        {
          "method": "updatePreferences",
          "namespace": "notifications",
          "policy": "cloud-only",
        },
        {
          "method": "getMine",
          "namespace": "signatures",
          "policy": "cloud-only",
        },
        {
          "method": "uploadMine",
          "namespace": "signatures",
          "policy": "cloud-only",
        },
        {
          "method": "deleteMine",
          "namespace": "signatures",
          "policy": "cloud-only",
        },
        {
          "method": "uploadAvatar",
          "namespace": "profileMedia",
          "policy": "cloud-only",
        },
        {
          "method": "deleteAvatar",
          "namespace": "profileMedia",
          "policy": "cloud-only",
        },
        {
          "method": "uploadLogo",
          "namespace": "organizationMedia",
          "policy": "cloud-only",
        },
        {
          "method": "deleteLogo",
          "namespace": "organizationMedia",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "signingCertificates",
          "policy": "cloud-only",
        },
        {
          "method": "upload",
          "namespace": "signingCertificates",
          "policy": "cloud-only",
        },
        {
          "method": "setDefault",
          "namespace": "signingCertificates",
          "policy": "cloud-only",
        },
        {
          "method": "revoke",
          "namespace": "signingCertificates",
          "policy": "cloud-only",
        },
        {
          "method": "setPolicy",
          "namespace": "signingCertificates",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "customers",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "lookupCnpj",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "ootEvents",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "customers",
          "policy": "local-command-sync",
        },
        {
          "method": "get",
          "namespace": "customers",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "update",
          "namespace": "customers",
          "policy": "local-command-sync",
        },
        {
          "method": "auditLog",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "updateCompliance",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "listMembers",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "listInvitations",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "createInvitation",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "resendInvitation",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "cancelInvitation",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "removeMember",
          "namespace": "customers",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "addBranch",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "removeBranch",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "listMembers",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "listInvitations",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "createInvitation",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "resendInvitation",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "cancelInvitation",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "removeMember",
          "namespace": "customerGroups",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "assets",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "create",
          "namespace": "assets",
          "policy": "local-command-sync",
        },
        {
          "method": "get",
          "namespace": "assets",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "update",
          "namespace": "assets",
          "policy": "local-command-sync",
        },
        {
          "method": "auditLog",
          "namespace": "assets",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "assetTypes",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "list",
          "namespace": "services",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "get",
          "namespace": "services",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "auditLog",
          "namespace": "services",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "services",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "services",
          "policy": "cloud-only",
        },
        {
          "method": "deactivate",
          "namespace": "services",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "materials",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "materials",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "materials",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "materials",
          "policy": "cloud-only",
        },
        {
          "method": "deactivate",
          "namespace": "materials",
          "policy": "cloud-only",
        },
        {
          "method": "adjustStock",
          "namespace": "materials",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "methods",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "get",
          "namespace": "methods",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "audit",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "archive",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "createNewVersion",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "technicalReview",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "qualityApprove",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "returnToDraft",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "compileDraft",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "previewDraft",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "publishDraft",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "requestApproval",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "listMethodTemplates",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "fromTemplate",
          "namespace": "methods",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "standards",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "get",
          "namespace": "standards",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "listCompositionProfiles",
          "namespace": "standards",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "createCompositionProfile",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "updateCompositionProfile",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "deleteCompositionProfile",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "auditLog",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "delete",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "renew",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "getImpactedCertificates",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "getRecall",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "sendRecall",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "uploadCertificateDocument",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "getCertificateDocumentDownloadUrl",
          "namespace": "standards",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "jobs",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "create",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "jobs",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "listTechnicians",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "approve",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "reject",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "cancel",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "assign",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "listStandards",
          "namespace": "jobs",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "getEffectiveEnvironmentalLimits",
          "namespace": "jobs",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "saveExecution",
          "namespace": "jobs",
          "policy": "local-command-sync",
        },
        {
          "method": "submitExecution",
          "namespace": "jobs",
          "policy": "local-command-sync",
        },
        {
          "method": "createCertificateDraft",
          "namespace": "jobs",
          "policy": "local-only",
        },
        {
          "method": "getCertificateDownloadUrl",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "generateLabel",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "getLabelDownloadUrl",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "getLabelCommands",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "amend",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "flagOutOfTolerance",
          "namespace": "jobs",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "serviceOrders",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "get",
          "namespace": "serviceOrders",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "listCommunications",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "serviceOrders",
          "policy": "local-command-sync",
        },
        {
          "method": "update",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "createQuote",
          "namespace": "serviceOrders",
          "policy": "local-command-sync",
        },
        {
          "method": "saveEvaluation",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "sendQuote",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "saveExecution",
          "namespace": "serviceOrders",
          "policy": "local-command-sync",
        },
        {
          "method": "generateIntakeDocument",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "getIntakeDocumentPdf",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "generateTag",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "getTagPdf",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "updateRepairMark",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "deliver",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "issueDeliveryDocument",
          "namespace": "serviceOrders",
          "policy": "local-command-sync",
        },
        {
          "method": "getDeliveryDocumentPdf",
          "namespace": "serviceOrders",
          "policy": "cloud-only",
        },
        {
          "method": "getSession",
          "namespace": "sync",
          "policy": "local-only",
        },
        {
          "method": "listConflicts",
          "namespace": "sync",
          "policy": "local-only",
        },
        {
          "method": "resolveConflict",
          "namespace": "sync",
          "policy": "local-only",
        },
        {
          "method": "list",
          "namespace": "attachments",
          "policy": "local-only",
        },
        {
          "method": "upload",
          "namespace": "attachments",
          "policy": "local-command-sync",
        },
        {
          "method": "list",
          "namespace": "environmentalLimits",
          "policy": "local-first-read-through-sync",
        },
        {
          "method": "save",
          "namespace": "environmentalLimits",
          "policy": "cloud-only",
        },
        {
          "method": "delete",
          "namespace": "environmentalLimits",
          "policy": "cloud-only",
        },
        {
          "method": "getExecutiveOverview",
          "namespace": "reports",
          "policy": "cloud-only",
        },
        {
          "method": "getComparison",
          "namespace": "reports",
          "policy": "cloud-only",
        },
        {
          "method": "getTrend",
          "namespace": "reports",
          "policy": "cloud-only",
        },
        {
          "method": "getSnapshot",
          "namespace": "publicCheckout",
          "policy": "cloud-only",
        },
        {
          "method": "getStatus",
          "namespace": "publicCheckout",
          "policy": "cloud-only",
        },
        {
          "method": "start",
          "namespace": "publicCheckout",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "publicLeads",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "publicInvitations",
          "policy": "cloud-only",
        },
        {
          "method": "requestSetupLink",
          "namespace": "publicInvitations",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "labSetup",
          "policy": "cloud-only",
        },
        {
          "method": "requestMagicLink",
          "namespace": "labSetup",
          "policy": "cloud-only",
        },
        {
          "method": "requestOtp",
          "namespace": "labSetup",
          "policy": "cloud-only",
        },
        {
          "method": "complete",
          "namespace": "labSetup",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "summary",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "auditLog",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "nonConformances",
          "policy": "local-command-sync",
        },
        {
          "method": "setDisposition",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "resolve",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "escalateToCapa",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "getOotNotification",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "registerOotAcknowledgement",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "getImpactAssessment",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "saveImpactAssessment",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "signImpactAssessment",
          "namespace": "nonConformances",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "summary",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "auditLog",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "implement",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "verify",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "close",
          "namespace": "capas",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "summary",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "auditLog",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "recordResults",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "remove",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "listPlan",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "createPlanItem",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "updatePlanItem",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "removePlanItem",
          "namespace": "proficiencyTests",
          "policy": "cloud-only",
        },
        {
          "method": "listCharts",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "getChart",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "createChart",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "updateChart",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "removeChart",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "recalculateChart",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "escalateChart",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "listReadings",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "createReading",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "removeReading",
          "namespace": "spc",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "duplicate",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "setDefault",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "getXlsxVersion",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "uploadXlsx",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "validateXlsx",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "updateXlsxBindings",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "createXlsxPreview",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "getXlsxPreview",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "publishXlsx",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "createXlsxAssignment",
          "namespace": "certificateTemplates",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "matrix",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "auditLog",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "transition",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "evaluate",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "renew",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "cancel",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "delete",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "assignTraining",
          "namespace": "competences",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "trainingRecords",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "trainingRecords",
          "policy": "cloud-only",
        },
        {
          "method": "getProfile",
          "namespace": "customerSuccess",
          "policy": "cloud-only",
        },
        {
          "method": "listRequests",
          "namespace": "customerSuccess",
          "policy": "cloud-only",
        },
        {
          "method": "createRequest",
          "namespace": "customerSuccess",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "calibrationRequests",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "calibrationRequests",
          "policy": "cloud-only",
        },
        {
          "method": "review",
          "namespace": "calibrationRequests",
          "policy": "cloud-only",
        },
        {
          "method": "approve",
          "namespace": "calibrationRequests",
          "policy": "cloud-only",
        },
        {
          "method": "reject",
          "namespace": "calibrationRequests",
          "policy": "cloud-only",
        },
        {
          "method": "convert",
          "namespace": "calibrationRequests",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "get",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "assign",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "confirm",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "reschedule",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "cancel",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "complete",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "addJob",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "removeJob",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "acceptRescheduleRequest",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "declineRescheduleRequest",
          "namespace": "visits",
          "policy": "cloud-only",
        },
        {
          "method": "list",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "create",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "startContaAzulOAuth",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "validate",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "update",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "updateContaAzulConfig",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "listContaAzulCatalog",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "pollContaAzul",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "pollContaAzulFiscal",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "linkContaAzulInvoicesToMdfe",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "pollContaAzulPayables",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "pollContaAzulProtocols",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "pollContaAzulDrift",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "getContaAzulSchedule",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "refreshContaAzul",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "disconnectContaAzul",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "toggle",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "previewSync",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "sync",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "schedule",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "listRunItems",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "retryRun",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "listDrift",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
        {
          "method": "acknowledgeDrift",
          "namespace": "integrations",
          "policy": "cloud-only",
        },
      ]
    `);
  });

  it("keeps policy-specific unavailable messages centralized", () => {
    expect(
      getDesktopDataPolicyUnavailableMessage("cloud-first-read-fallback"),
    ).toContain("fallback local");
    expect(getDesktopDataPolicyUnavailableMessage("cloud-only")).toContain(
      "API da nuvem",
    );
    expect(getDesktopDataPolicyUnavailableMessage("local-only")).toContain(
      "runtime local",
    );
  });
});

describe("desktop runtime detection", () => {
  it("detects the Electron renderer even before the preload bridge is available", () => {
    expect(
      isDesktopRuntime(
        testWindow({
          navigator: {
            userAgent:
              "Mozilla/5.0 CalibraFacil Chrome/142.0.0.0 Electron/39.8.10",
          },
        }),
      ),
    ).toBe(true);
  });

  it("detects the preload bridge when it is available", () => {
    expect(
      isDesktopRuntime(
        testWindow({
          calibraBridge: {},
          navigator: { userAgent: "Mozilla/5.0 Chrome/142.0.0.0" },
        }),
      ),
    ).toBe(true);
  });
});

describe("dashboard units runtime adapter", () => {
  it("returns null when the cloud units endpoint denies access", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return new Response(null, { status: 403 });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.units.getDashboardUnits()).resolves.toBeNull();
    expect(String(fetchCalls[0]?.[0])).toBe(
      "https://api.example.test/api/units",
    );
  });

  it("maps desktop local session units into the dashboard units shape", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        data: {
          serverTime: "2026-05-09T12:00:00.000Z",
          user: {
            id: "user-1",
            name: "Ana",
            email: "ana@example.test",
          },
          organization: {
            id: "org-1",
            type: "laboratory",
          },
          activeUnits: [
            {
              id: 10,
              name: "Laboratorio Central",
              role: "unit_admin",
            },
            {
              id: 20,
              name: "Unidade Norte",
              role: "technician",
            },
          ],
          permissions: {
            role: "member",
            unitRole: "unit_admin",
            activeUnitId: 10,
            accessibleUnitIds: [10, 20],
            canAccessAllUnits: true,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: "cursor-1",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [],
          jobs: [],
          serviceOrders: [],
        },
      });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await expect(client.units.getDashboardUnits()).resolves.toMatchObject({
      activeUnitId: 10,
      activeUnitName: "Laboratorio Central",
      selectedUnitScope: "unit",
      canAccessAllUnits: true,
      data: [
        {
          id: 10,
          name: "Laboratorio Central",
          slug: "laboratorio-central",
          role: "unit_admin",
        },
        {
          id: 20,
          name: "Unidade Norte",
          slug: "unidade-norte",
          role: "technician",
        },
      ],
      scopeSummary: {
        activeUnitId: 10,
        activeUnitName: "Laboratorio Central",
        effectiveRole: "unit_admin",
        effectiveRoleLabel: "Admin. da unidade",
      },
    });

    expect(String(fetchCalls[0]?.[0])).toBe(
      "http://127.0.0.1:4317/api/local/session",
    );
    expect(new Headers(fetchCalls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer local-token",
    );
  });
});

describe("unit governance runtime adapter", () => {
  it("routes unit governance operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/admin/units") && init?.method === "POST") {
        return Response.json({ id: 10, name: "Central" }, { status: 201 });
      }

      if (url.endsWith("/admin/units/10")) {
        return Response.json({ id: 10, name: "Central atualizada" });
      }

      if (url.endsWith("/assignments")) {
        return Response.json({ success: true });
      }

      if (url.endsWith("/role")) {
        return Response.json({ success: true });
      }

      if (url.endsWith("/admin/members")) {
        return Response.json({ data: [], viewer: { canViewGovernance: true } });
      }

      if (url.endsWith("/admin/activity")) {
        return Response.json({ data: [], viewer: { canViewGovernance: true } });
      }

      return Response.json({ data: [], viewer: { canViewGovernance: true } });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.units.listAdminUnits()).resolves.toMatchObject({
      data: [],
    });
    await expect(client.units.listAdminMembers()).resolves.toMatchObject({
      data: [],
    });
    await expect(client.units.listAdminActivity()).resolves.toMatchObject({
      data: [],
    });
    await expect(
      client.units.createAdminUnit("Central"),
    ).resolves.toMatchObject({ id: 10 });
    await expect(
      client.units.updateAdminUnit(10, { name: "Central atualizada" }),
    ).resolves.toMatchObject({ name: "Central atualizada" });
    await expect(
      client.units.updateMemberAssignments("member-1", [
        { unitId: 10, role: "technician" },
      ]),
    ).resolves.toEqual({ success: true });
    await expect(
      client.units.updateMemberRole("member-1", "admin"),
    ).resolves.toEqual({ success: true });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/units/admin/units",
      "https://api.example.test/api/units/admin/members",
      "https://api.example.test/api/units/admin/activity",
      "https://api.example.test/api/units/admin/units",
      "https://api.example.test/api/units/admin/units/10",
      "https://api.example.test/api/units/admin/members/member-1/assignments",
      "https://api.example.test/api/units/admin/members/member-1/role",
    ]);
  });

  it("keeps unit governance mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.units.listAdminUnits()).resolves.toMatchObject({
      data: [],
      viewer: { canViewGovernance: false },
    });
    await expect(client.units.createAdminUnit("Central")).rejects.toThrow(
      "Governança de unidades requer a API web/nuvem",
    );
  });
});

describe("access runtime adapter", () => {
  it("loads plan and finance access through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/billing/access")) {
        return Response.json({
          planId: "professional",
          planName: "Professional",
          status: "active",
          limits: {
            certificates: 1000,
            users: 20,
            storage: 100,
          },
          entitlements: ["multi_unit", "financial"],
          hasFinancial: true,
          hasFinancialModule: true,
          canManageBilling: true,
          hasApi: true,
          hasCustomDomain: true,
          hasCustomTemplates: true,
          hasSso: false,
        });
      }

      return Response.json({
        planId: "professional",
        planName: "Professional",
        status: "active",
        entitlements: ["financial"],
        hasFinancialModule: true,
        hasFinancialIntegrations: false,
        canReadFinancial: true,
        canManageFinancial: true,
        canExportFinancial: true,
        role: "owner",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.access.getPlanAccess()).resolves.toMatchObject({
      planId: "professional",
      hasFinancialModule: true,
    });
    await expect(client.access.getFinanceAccess()).resolves.toMatchObject({
      role: "owner",
      canReadFinancial: true,
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/billing/access",
      "https://api.example.test/api/finance/access",
    ]);
  });

  it("returns desktop-local access fallbacks without calling fetch", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.access.getPlanAccess()).resolves.toMatchObject({
      planId: "desktop-local",
      hasCustomTemplates: true,
      hasFinancialModule: false,
    });
    await expect(client.access.getFinanceAccess()).resolves.toMatchObject({
      planId: "desktop-local",
      hasFinancialModule: false,
      canReadFinancial: false,
    });
  });
});

describe("sessions runtime adapter", () => {
  it("revokes sessions through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({ status: true });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.sessions.revoke("session-1")).resolves.toEqual({
      status: true,
    });
    expect(String(fetchCalls[0]?.[0])).toBe(
      "https://api.example.test/api/sessions/revoke",
    );
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      sessionId: "session-1",
    });
  });

  it("keeps session revocation cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.sessions.revoke("session-1")).rejects.toThrow(
      "Gerenciamento de sessoes requer a API web/nuvem",
    );
  });
});

describe("billing runtime adapter", () => {
  it("loads subscription and payments through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/billing/subscription")) {
        return Response.json({
          subscription: {
            id: 1,
            planId: "professional",
            status: "ACTIVE",
            billingCycle: "MONTHLY",
            nextBillingDate: "2026-06-09T12:00:00.000Z",
          },
          plan: {
            id: "professional",
            name: "Professional",
            description: "Plano Professional",
          },
          usage: { jobsCreated: 8, users: 3, storage: 1024 },
          limits: { certificates: 1000, users: 20, storage: 100 },
        });
      }

      return Response.json({
        data: [
          {
            id: 10,
            amount: 19990,
            status: "CONFIRMED",
            paymentMethod: "PIX",
            createdAt: "2026-05-09T12:00:00.000Z",
            invoiceUrl: "https://billing.example.test/invoice/10",
          },
        ],
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.billing.getSubscription()).resolves.toMatchObject({
      subscription: { status: "ACTIVE" },
      usage: { jobsCreated: 8 },
    });
    await expect(
      client.billing.listPayments({ limit: 10, offset: 0 }),
    ).resolves.toMatchObject({
      data: [{ id: 10, paymentMethod: "PIX" }],
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/billing/subscription",
      "https://api.example.test/api/billing/payments?limit=10&offset=0",
    ]);
  });

  it("returns desktop-local billing fallbacks without calling fetch", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.billing.getSubscription()).resolves.toMatchObject({
      subscription: null,
      plan: { id: "desktop-local" },
      usage: { jobsCreated: 0, users: 1 },
    });
    await expect(client.billing.listPayments()).resolves.toEqual({
      data: [],
    });
  });
});

describe("backoffice runtime adapter", () => {
  it("routes backoffice access and impersonation through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/backoffice/access")) {
        return Response.json({
          allowed: true,
          roles: ["platform_admin"],
          bootstrapAvailable: false,
          isImpersonating: false,
          session: {
            userId: "user-1",
            email: "admin@example.test",
          },
        });
      }

      return Response.json({ ok: true });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.backoffice.getAccess()).resolves.toMatchObject({
      allowed: true,
      roles: ["platform_admin"],
    });
    await expect(client.backoffice.stopImpersonation()).resolves.toEqual({
      ok: true,
    });
    await expect(
      client.backoffice.provisionLab({
        lab: { name: "Lab A" },
        owner: { name: "Owner A", email: "owner@example.test" },
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/backoffice/access",
      "https://api.example.test/api/backoffice/impersonation/stop",
      "https://api.example.test/api/backoffice/labs",
    ]);
    expect(fetchCalls[1]?.[1]?.method).toBe("POST");
    expect(fetchCalls[2]?.[1]?.method).toBe("POST");
  });

  it("keeps backoffice impersonation cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.backoffice.getAccess()).resolves.toMatchObject({
      allowed: false,
      bootstrapAvailable: false,
    });
    await expect(client.backoffice.stopImpersonation()).rejects.toThrow(
      "Impersonação backoffice requer a API web/nuvem",
    );
  });
});

describe("public invitations runtime adapter", () => {
  it("requests invitation setup links through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({ setupLinkRequested: true });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.publicInvitations.requestSetupLink("invite-1"),
    ).resolves.toEqual({ setupLinkRequested: true });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/invitations/invite-1/request-setup-link",
    ]);
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
  });
});

describe("lab setup runtime adapter", () => {
  it("loads ready setup metadata through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        status: "ready",
        email: "owner@lab.test",
        organizationName: "Lab Acreditado",
        organizationSlug: "lab-acreditado",
        expiresAt: "2030-01-01T00:00:00.000Z",
        passkeyPreferred: true,
        fallbackMethods: ["magic_link", "email_otp"],
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.labSetup.get("setup-token")).resolves.toEqual({
      status: "ready",
      email: "owner@lab.test",
      organizationName: "Lab Acreditado",
      organizationSlug: "lab-acreditado",
      expiresAt: "2030-01-01T00:00:00.000Z",
      passkeyPreferred: true,
      fallbackMethods: ["magic_link", "email_otp"],
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/lab-setup/setup-token",
    ]);
    expect(fetchCalls[0]?.[1]?.method).toBe("GET");
  });

  it("preserves rejected setup-token status payloads for the claim UI", async () => {
    const fetchMock: typeof fetch = async () =>
      Response.json(
        {
          status: "expired",
          passkeyPreferred: true,
          fallbackMethods: ["magic_link", "email_otp"],
        },
        { status: 410 },
      );
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.labSetup.get("expired-token")).resolves.toEqual({
      status: "expired",
      passkeyPreferred: true,
      fallbackMethods: ["magic_link", "email_otp"],
    });
  });
});

describe("sso runtime adapter", () => {
  it("starts SSO through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        url: "https://idp.example.test/login",
        redirect: true,
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.sso.start({
        organizationSlug: "laboratorio-central",
        email: "ana@example.test",
        redirectPath: "/dashboard",
      }),
    ).resolves.toEqual({
      url: "https://idp.example.test/login",
      redirect: true,
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/sso/start",
    ]);
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
  });

  it("routes SSO provider management through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const provider = {
      id: "provider-row-1",
      providerId: "okta",
      issuer: "https://idp.example.test",
      domain: "https://example.test",
      domainHost: "example.test",
      domainVerified: false,
      organizationId: "org-1",
      type: "oidc",
      redirectURI: "https://api.example.test/api/auth/callback/okta",
      oidcConfig: {
        discoveryEndpoint:
          "https://idp.example.test/.well-known/openid-configuration",
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
        scopes: ["openid", "email", "profile"],
        pkce: true,
        clientIdLastFour: "1234",
        tokenEndpointAuthentication: null,
      },
    };
    const verificationRecord = {
      type: "TXT" as const,
      host: "_calibrafacil-sso.example.test",
      value: "verify-token",
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/request-domain-verification")) {
        return Response.json({ verificationRecord });
      }

      if (url.endsWith("/verify-domain")) {
        return Response.json({
          provider: { ...provider, domainVerified: true },
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (init?.method === "POST") {
        return Response.json({ provider, verificationRecord }, { status: 201 });
      }

      return Response.json({
        provider,
        access: {
          role: "owner",
          canCreate: true,
          canManage: true,
          canDelete: true,
        },
        billing: {
          planId: "enterprise",
          planName: "Enterprise",
          status: "active",
          hasSso: true,
        },
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.sso.getProviders()).resolves.toMatchObject({
      provider: { providerId: "okta" },
      billing: { hasSso: true },
    });
    await expect(
      client.sso.createProvider({
        providerId: "okta",
        issuer: "https://idp.example.test",
        domain: "example.test",
        clientId: "client-id",
        clientSecret: "client-secret",
        scopes: ["openid", "email", "profile"],
      }),
    ).resolves.toMatchObject({
      provider: { providerId: "okta" },
      verificationRecord,
    });
    await expect(client.sso.requestDomainVerification("okta")).resolves.toEqual(
      { verificationRecord },
    );
    await expect(client.sso.verifyDomain("okta")).resolves.toMatchObject({
      provider: { domainVerified: true },
    });
    await expect(client.sso.deleteProvider("okta")).resolves.toBeUndefined();

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/sso/providers",
      "https://api.example.test/api/sso/providers",
      "https://api.example.test/api/sso/providers/okta/request-domain-verification",
      "https://api.example.test/api/sso/providers/okta/verify-domain",
      "https://api.example.test/api/sso/providers/okta",
    ]);
  });

  it("keeps SSO cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(
      client.sso.start({ organizationSlug: "laboratorio-central" }),
    ).rejects.toThrow("Login SSO requer a API web/nuvem");
    await expect(client.sso.getProviders()).resolves.toMatchObject({
      provider: null,
      billing: { hasSso: false },
    });
    await expect(
      client.sso.createProvider({
        providerId: "okta",
        issuer: "https://idp.example.test",
        domain: "example.test",
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).rejects.toThrow("Configuração SSO requer a API web/nuvem");
  });
});

describe("api keys runtime adapter", () => {
  it("routes API key management through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const key = {
      id: "key-1",
      name: "Automation",
      keyPrefix: "cf_live_1234",
      scopes: ["customers:read", "jobs:write"],
      lastUsedAt: null,
      createdAt: "2026-05-09T12:00:00.000Z",
      revokedAt: null,
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/rotate")) {
        return Response.json({
          secret: "cf_live_rotated",
          key: { ...key, keyPrefix: "cf_live_5678" },
        });
      }

      if (url.endsWith("/revoke")) {
        return Response.json({ success: true });
      }

      if (init?.method === "POST") {
        return Response.json(
          {
            secret: "cf_live_secret",
            key,
          },
          { status: 201 },
        );
      }

      return Response.json({ data: [key] });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.apiKeys.list()).resolves.toMatchObject({
      data: [{ id: "key-1", keyPrefix: "cf_live_1234" }],
    });
    await expect(
      client.apiKeys.create({
        name: "Automation",
        scopes: ["customers:read", "jobs:write"],
      }),
    ).resolves.toMatchObject({
      secret: "cf_live_secret",
      key: { id: "key-1" },
    });
    await expect(client.apiKeys.rotate("key-1")).resolves.toMatchObject({
      secret: "cf_live_rotated",
      key: { keyPrefix: "cf_live_5678" },
    });
    await expect(client.apiKeys.revoke("key-1")).resolves.toEqual({
      success: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/api-keys",
      "https://api.example.test/api/api-keys",
      "https://api.example.test/api/api-keys/key-1/rotate",
      "https://api.example.test/api/api-keys/key-1/revoke",
    ]);
  });

  it("keeps API key mutations cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.apiKeys.list()).resolves.toEqual({ data: [] });
    await expect(client.apiKeys.create({ name: "Automation" })).rejects.toThrow(
      "API keys requer a API web/nuvem",
    );
    await expect(client.apiKeys.rotate("key-1")).rejects.toThrow(
      "API keys requer a API web/nuvem",
    );
    await expect(client.apiKeys.revoke("key-1")).rejects.toThrow(
      "API keys requer a API web/nuvem",
    );
  });
});

describe("methods runtime adapter", () => {
  it("routes Method Builder actions through the cloud methods facade", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (url.pathname === "/api/methods/compile") {
        return Response.json({
          diagnostics: [],
          fingerprint: "fp-1",
          normalizedFormulas: [{ outputKey: "erro", expression: "a-b" }],
        });
      }

      if (url.pathname === "/api/methods/preview") {
        return Response.json({
          diagnostics: [],
          results: { erro: 0.1 },
          normalizedData: { leitura: 10 },
        });
      }

      if (url.pathname === "/api/methods/12/publish") {
        return Response.json({ id: 12, status: "PUBLISHED" });
      }

      if (url.pathname === "/api/methods/12/request-approval") {
        return Response.json({ id: 12, status: "TECHNICAL_REVIEW" });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.methods.compileDraft({ draft: { name: "Massa" } }),
    ).resolves.toMatchObject({ fingerprint: "fp-1" });
    await expect(
      client.methods.previewDraft({
        draft: { name: "Massa" },
        sampleData: { leitura: 10 },
      }),
    ).resolves.toMatchObject({ results: { erro: 0.1 } });
    await expect(
      client.methods.publishDraft(12, {
        sampleData: { leitura: 10 },
        reasonForChange: "Publicação inicial",
      }),
    ).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(
      client.methods.requestApproval(12, { sampleData: { leitura: 10 } }),
    ).resolves.toMatchObject({ status: "TECHNICAL_REVIEW" });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/methods/compile",
      "https://api.example.test/api/methods/preview",
      "https://api.example.test/api/methods/12/publish",
      "https://api.example.test/api/methods/12/request-approval",
    ]);
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      draft: { name: "Massa" },
    });
    expect(JSON.parse(String(fetchCalls[2]?.[1]?.body))).toEqual({
      sampleData: { leitura: 10 },
      reasonForChange: "Publicação inicial",
    });
  });

  it("returns method diagnostics responses from validation failures", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json(
          { diagnostics: [{ message: "Fórmula inválida" }] },
          { status: 422 },
        ),
    });

    await expect(
      client.methods.compileDraft({ draft: { name: "Massa" } }),
    ).resolves.toEqual({
      diagnostics: [{ message: "Fórmula inválida" }],
    });
  });

  it("rejects method status mutations with diagnostics failures", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json(
          { diagnostics: [{ message: "Amostra inválida" }] },
          { status: 422 },
        ),
    });

    await expect(
      client.methods.publishDraft(12, {
        sampleData: { leitura: 10 },
        reasonForChange: "Publicação inicial",
      }),
    ).rejects.toMatchObject({
      status: 422,
      payload: { diagnostics: [{ message: "Amostra inválida" }] },
    });
    await expect(
      client.methods.requestApproval(12, { sampleData: { leitura: 10 } }),
    ).rejects.toMatchObject({
      status: 422,
      payload: { diagnostics: [{ message: "Amostra inválida" }] },
    });
  });
});

describe("non-conformances runtime adapter", () => {
  it("creates NCs through the cloud API facade", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({ id: 10, ncNumber: "NC-2026-001" });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.nonConformances.create({
        type: "work",
        description: "Leitura fora da faixa esperada",
        detectedAt: "2026-05-20T12:00:00.000Z",
        jobId: 42,
      }),
    ).resolves.toEqual({ id: 10, ncNumber: "NC-2026-001" });

    expect(String(fetchCalls[0]?.[0])).toBe("https://api.example.test/api/nc");
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      type: "work",
      description: "Leitura fora da faixa esperada",
      detectedAt: "2026-05-20T12:00:00.000Z",
      jobId: 42,
    });
  });

  it("throws API errors from NC creation", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json({ error: "Descrição inválida" }, { status: 400 }),
    });

    await expect(
      client.nonConformances.create({
        type: "work",
        description: "Leitura fora da faixa esperada",
        detectedAt: "2026-05-20T12:00:00.000Z",
      }),
    ).rejects.toThrow("Descrição inválida");
  });
});

describe("entity labels runtime adapter", () => {
  it("loads NC, CAPA, and competence labels through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/nc/10/label")) {
        return Response.json({ label: "NC-2026-001" });
      }

      if (url.endsWith("/api/capa/20/label")) {
        return Response.json({ label: "CAPA-2026-001" });
      }

      return Response.json({ label: "Ana Silva" });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.entityLabels.getNonConformance(10)).resolves.toBe(
      "NC-2026-001",
    );
    await expect(client.entityLabels.getCapa(20)).resolves.toBe(
      "CAPA-2026-001",
    );
    await expect(client.entityLabels.getCompetence(30)).resolves.toBe(
      "Ana Silva",
    );

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/nc/10/label",
      "https://api.example.test/api/capa/20/label",
      "https://api.example.test/api/competences/30/label",
    ]);
  });

  it("returns null for missing cloud labels and desktop labels", async () => {
    const cloudClient = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(null, { status: 404 }),
    });
    const desktopClient = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(cloudClient.entityLabels.getCapa(404)).resolves.toBeNull();
    await expect(
      desktopClient.entityLabels.getNonConformance(10),
    ).resolves.toBeNull();
    await expect(desktopClient.entityLabels.getCapa(20)).resolves.toBeNull();
    await expect(
      desktopClient.entityLabels.getCompetence(30),
    ).resolves.toBeNull();
  });
});

describe("certificate templates XLSX runtime adapter", () => {
  it("routes XLSX operations through the cloud API facade", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/upload-xlsx")) {
        return Response.json({
          item: { id: 10 },
          analysis: {},
          bindingManifest: {},
        });
      }
      if (url.endsWith("/validate")) {
        return Response.json({
          item: { id: 10 },
          analysis: {},
          validation: { ok: true, warnings: [] },
        });
      }
      if (url.endsWith("/bindings")) {
        return Response.json({ item: { id: 10 } });
      }
      if (url.endsWith("/preview")) {
        return Response.json({ item: { id: 20 } });
      }
      if (url.endsWith("/previews/20")) {
        return Response.json({ item: { status: "ready" } });
      }
      if (url.endsWith("/publish")) {
        return Response.json({ item: { id: 10, status: "published" } });
      }
      if (url.endsWith("/assignments")) {
        return Response.json({ item: { id: 30 } });
      }
      return Response.json({
        item: { id: 10 },
        analysis: {},
        bindingManifest: {},
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "20",
      fetch: fetchMock,
    });

    await client.certificateTemplates.getXlsxVersion(1, 10);
    await client.certificateTemplates.uploadXlsx(
      1,
      new Blob(["xlsx"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      { fileName: "template.xlsx" },
    );
    await client.certificateTemplates.validateXlsx(1, 10);
    await client.certificateTemplates.updateXlsxBindings(1, 10, {
      manifest: { scalarBindings: [] },
    });
    await client.certificateTemplates.createXlsxPreview(1, 10, {
      sampleData: {},
    });
    await client.certificateTemplates.getXlsxPreview(1, 10, 20);
    await client.certificateTemplates.publishXlsx(1, 10);
    await client.certificateTemplates.createXlsxAssignment(1, 10, {
      certificateType: "calibration",
      priority: 100,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/certificate-templates/1/versions/10",
      "https://api.example.test/api/certificate-templates/1/versions/upload-xlsx",
      "https://api.example.test/api/certificate-templates/1/versions/10/validate",
      "https://api.example.test/api/certificate-templates/1/versions/10/bindings",
      "https://api.example.test/api/certificate-templates/1/versions/10/preview",
      "https://api.example.test/api/certificate-templates/1/versions/10/previews/20",
      "https://api.example.test/api/certificate-templates/1/versions/10/publish",
      "https://api.example.test/api/certificate-templates/1/versions/10/assignments",
    ]);
    expect(fetchCalls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "POST",
      "POST",
      "PATCH",
      "POST",
      "GET",
      "POST",
      "POST",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["20", "20", "20", "20", "20", "20", "20", "20"]);
    expect(fetchCalls[1]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[1]?.[1]).get("xlsx")).toBeInstanceOf(Blob);
    expect(new Headers(fetchCalls[3]?.[1]?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("keeps XLSX template operations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(
      client.certificateTemplates.getXlsxVersion(1, 10),
    ).rejects.toThrow(
      "Templates de certificado requer a API web/nuvem neste momento.",
    );
    await expect(
      client.certificateTemplates.uploadXlsx(1, new Blob(["xlsx"])),
    ).rejects.toThrow(
      "Templates de certificado requer a API web/nuvem neste momento.",
    );
  });
});

describe("desktop hybrid runtime adapter", () => {
  it("uses cloud APIs for shared parity data before local bootstrap and local APIs for desktop-only data", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "https://api.example.test" &&
        url.pathname === "/api/standards"
      ) {
        return Response.json({
          data: [
            {
              id: 1,
              name: "Peso padrao 20 kg",
              serialNumber: "STD-20KG",
              certificateNumber: "CERT-1",
              nextCalibrationDate: "2026-12-31",
              status: "ACTIVE",
              isExpired: false,
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/attachments"
      ) {
        return Response.json({ data: [] });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        activeUnitProvider: () => "10",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(
      client.standards.list({ page: 1, limit: 20 }),
    ).resolves.toMatchObject({
      data: [{ name: "Peso padrao 20 kg" }],
    });
    await expect(client.sync.getSession()).resolves.toMatchObject({
      data: { user: { id: "user-1" } },
    });
    await expect(client.attachments.list()).resolves.toEqual({ data: [] });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/standards?page=1&limit=20",
      "http://127.0.0.1:4317/api/attachments",
    ]);
    expect(fetchCalls[1]?.[1]?.credentials).toBe("include");
    expect(
      new Headers(fetchCalls[1]?.[1]?.headers).get("x-active-unit-id"),
    ).toBe("10");
    expect(new Headers(fetchCalls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer local-token",
    );
  });

  it("keeps certificate draft generation on the local desktop API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/jobs/job-1/certificate-draft"
      ) {
        return Response.json({
          id: "draft-1",
          jobId: "job-1",
          localPath: "certificates/job-1/draft-1.html",
          status: "draft",
          metadata: {},
          createdAt: "2026-01-15T10:00:00.000Z",
          updatedAt: "2026-01-15T10:00:00.000Z",
          contentType: "text/html",
          fileUrl: "/api/jobs/job-1/certificate-draft/file",
          draftKind: "local_certificate_draft",
          published: false,
        });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(client.jobs.createCertificateDraft("job-1")).resolves.toEqual({
      id: "draft-1",
      jobId: "job-1",
      localPath: "certificates/job-1/draft-1.html",
      status: "draft",
      metadata: {},
      createdAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T10:00:00.000Z",
      contentType: "text/html",
      fileUrl: "/api/jobs/job-1/certificate-draft/file",
      draftKind: "local_certificate_draft",
      published: false,
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/jobs/job-1/certificate-draft",
    ]);
  });

  it("keeps slash-bearing job identifiers in one API route segment", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({ ok: true, data: { jobId: "R-0001/2026" } });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await client.jobs.get("R-0001/2026");
    await client.jobs.get("R-0001%2F2026");
    await client.jobs.saveExecution(
      "R-0001/2026",
      testPayload<JobExecutionPayload>({
        status: "draft",
        measurements: [],
      }),
    );
    await client.jobs.submitExecution(
      "R-0001%2F2026",
      testPayload<JobExecutionPayload>({
        status: "submitted",
        measurements: [],
      }),
    );
    await client.jobs.createCertificateDraft("R-0001/2026");

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026/execute",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026/submit",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026/certificate-draft",
    ]);
  });

  it("routes supported offline command methods to the local outbox API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (url.origin !== "http://127.0.0.1:4317") {
        throw new Error(`Unexpected cloud request: ${url.toString()}`);
      }

      return Response.json({ ok: true, data: { id: "local-1" } });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.customers.create({
      name: "Cliente local",
      email: "cliente@example.test",
      phone: "555",
      taxId: "123",
    });
    await client.customers.update(1, { name: "Cliente atualizado" });
    await client.assets.create({
      customerId: 1,
      assetTypeId: 2,
      name: "Ativo local",
      tag: "TAG-1",
      serialNumber: "SN-1",
      manufacturer: "Fabricante",
      model: "Modelo",
    });
    await client.assets.update(1, { name: "Ativo atualizado" });
    await client.jobs.saveExecution(
      "job-1",
      testPayload<JobExecutionPayload>({
        status: "draft",
        measurements: [],
      }),
    );
    await client.jobs.submitExecution(
      "job-1",
      testPayload<JobExecutionPayload>({
        status: "submitted",
        measurements: [],
      }),
    );
    await client.serviceOrders.create(
      testPayload<CreateServiceOrderInput>({
        customerId: 1,
        priority: "normal",
        intakeType: "dropoff",
        items: [],
      }),
    );
    await client.serviceOrders.createQuote("service-order-1", {
      items: [],
    });
    await client.serviceOrders.saveExecution("service-order-1", {
      technicalNotes: "Execução local",
    });
    await client.serviceOrders.issueDeliveryDocument("service-order-1", {
      technicianSignatureData: null,
      clientSignatureData: null,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/customers",
      "http://127.0.0.1:4317/api/customers/1",
      "http://127.0.0.1:4317/api/assets",
      "http://127.0.0.1:4317/api/assets/1",
      "http://127.0.0.1:4317/api/jobs/job-1/execute",
      "http://127.0.0.1:4317/api/jobs/job-1/submit",
      "http://127.0.0.1:4317/api/service-orders",
      "http://127.0.0.1:4317/api/service-orders/service-order-1/quotes",
      "http://127.0.0.1:4317/api/service-orders/service-order-1/execution",
      "http://127.0.0.1:4317/api/service-orders/service-order-1/delivery-document",
    ]);
    expect(fetchCalls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "PUT",
      "POST",
      "PUT",
      "POST",
      "POST",
      "POST",
      "POST",
      "PATCH",
      "POST",
    ]);
  });

  it("routes approved desktop parity reads to the cloud until local bootstrap completes", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (url.origin !== "https://api.example.test") {
        throw new Error(`Unexpected request: ${url.toString()}`);
      }

      return Response.json({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        limits: [],
        source: null,
      });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.dashboard.getStats();
    await client.customers.list({ page: 1, limit: 20 });
    await client.assets.list({ page: 1, limit: 20 });
    await client.assetTypes.list();
    await client.services.list({ page: 1, limit: 20 });
    await client.methods.list({ page: 1, limit: 20 });
    await client.standards.list({ page: 1, limit: 20 });
    await client.environmentalLimits.list();
    await client.jobs.list({ page: 1, limit: 20 });
    await client.serviceOrders.list({ page: 1, limit: 20 });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/dashboard/stats",
      "https://api.example.test/api/customers?page=1&limit=20",
      "https://api.example.test/api/assets?page=1&limit=20",
      "https://api.example.test/api/asset-types?",
      "https://api.example.test/api/services?page=1&limit=20",
      "https://api.example.test/api/methods?page=1&limit=20",
      "https://api.example.test/api/standards?page=1&limit=20",
      "https://api.example.test/api/environmental-limits",
      "https://api.example.test/api/jobs?page=1&limit=20",
      "https://api.example.test/api/service-orders?page=1&limit=20",
    ]);
  });

  it("routes all approved operational reads to local cache after bootstrap", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [{ id: 10, name: "Laboratorio Central" }],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: 10,
              accessibleUnitIds: [10],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: "cursor-1",
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/sync/retry"
      ) {
        return Response.json({ ok: true });
      }

      if (url.origin !== "http://127.0.0.1:4317") {
        throw new Error(`Unexpected cloud request: ${url.toString()}`);
      }

      if (url.pathname === "/api/service-orders/service-order-1") {
        return Response.json({ data: { id: "service-order-1" } });
      }

      return Response.json({
        id: url.pathname.split("/").at(-1),
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        limits: null,
        source: null,
      });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.dashboard.getStats();
    await client.customers.list({ page: 1, limit: 20 });
    await client.customers.get(1);
    await client.assets.list({ page: 1, limit: 20 });
    await client.assets.get(1);
    await client.assetTypes.list();
    await client.services.list({ page: 1, limit: 20 });
    await client.services.get(1);
    await client.methods.list({ page: 1, limit: 20 });
    await client.methods.get(1);
    await client.standards.list({ page: 1, limit: 20 });
    await client.standards.get(1);
    await client.environmentalLimits.list();
    await client.jobs.list({ page: 1, limit: 20 });
    await client.jobs.get("job-1");
    await client.jobs.listStandards();
    await client.jobs.getEffectiveEnvironmentalLimits(1, { unitId: 10 });
    await client.serviceOrders.list({ page: 1, limit: 20 });
    await client.serviceOrders.get("service-order-1");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "http://127.0.0.1:4317/api/dashboard/stats",
      "http://127.0.0.1:4317/api/local/sync/retry",
      "http://127.0.0.1:4317/api/customers?page=1&limit=20",
      "http://127.0.0.1:4317/api/customers/1",
      "http://127.0.0.1:4317/api/assets?page=1&limit=20",
      "http://127.0.0.1:4317/api/assets/1",
      "http://127.0.0.1:4317/api/asset-types",
      "http://127.0.0.1:4317/api/services?page=1&limit=20",
      "http://127.0.0.1:4317/api/services/1",
      "http://127.0.0.1:4317/api/methods?page=1&limit=20",
      "http://127.0.0.1:4317/api/methods/1",
      "http://127.0.0.1:4317/api/standards?page=1&limit=20",
      "http://127.0.0.1:4317/api/standards/1",
      "http://127.0.0.1:4317/api/jobs?page=1&limit=20",
      "http://127.0.0.1:4317/api/jobs/job-1",
      "http://127.0.0.1:4317/api/standards?status=ACTIVE&limit=100",
      "http://127.0.0.1:4317/api/environmental-limits/effective/1?unitId=10",
      "http://127.0.0.1:4317/api/service-orders?page=1&limit=20",
      "http://127.0.0.1:4317/api/service-orders/service-order-1",
    ]);
  });

  it("uses bootstrapped local cache first for approved operational reads", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: "cursor-1",
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/standards"
      ) {
        return Response.json({
          data: [
            {
              id: 2,
              name: "Peso local 10 kg",
              serialNumber: "STD-10KG",
              certificateNumber: "CERT-LOCAL",
              nextCalibrationDate: "2026-12-31",
              status: "ACTIVE",
              isExpired: false,
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/sync/retry"
      ) {
        return Response.json({ ok: true });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(
      client.standards.list({ page: 1, limit: 20 }),
    ).resolves.toMatchObject({
      data: [{ name: "Peso local 10 kg" }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "http://127.0.0.1:4317/api/standards?page=1&limit=20",
      "http://127.0.0.1:4317/api/local/sync/retry",
    ]);
  });

  it("does not use local reads before a completed bootstrap cursor exists", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const cloudError = new TypeError("fetch failed");
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "https://api.example.test" &&
        url.pathname === "/api/standards"
      ) {
        throw cloudError;
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(client.standards.list({ page: 1, limit: 20 })).rejects.toThrow(
      "cache local",
    );

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/standards?page=1&limit=20",
    ]);
  });

  it("does not use local fallback for cloud authorization failures", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "https://api.example.test" &&
        url.pathname === "/api/standards"
      ) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(client.standards.list({ page: 1, limit: 20 })).rejects.toThrow(
      "Unauthorized",
    );

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/standards?page=1&limit=20",
    ]);
  });
});

describe("environmental limits runtime adapter", () => {
  it("routes environmental settings through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const limit = {
      id: 15,
      unitId: 10,
      assetTypeId: null,
      assetTypeName: null,
      temperatureMin: 18,
      temperatureMax: 24,
      humidityMin: 40,
      humidityMax: 60,
      pressureMin: null,
      pressureMax: null,
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "PUT") {
        return Response.json({
          message: "Limites ambientais atualizados",
          data: limit,
          unit: { unitId: 10, unitName: "Central" },
        });
      }

      if (init?.method === "DELETE") {
        return Response.json({ message: "Limites removidos" });
      }

      return Response.json({
        limits: [limit],
        unit: { unitId: 10, unitName: "Central" },
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.environmentalLimits.list()).resolves.toMatchObject({
      limits: [{ id: 15, temperatureMin: 18 }],
    });
    await expect(
      client.environmentalLimits.save({
        assetTypeId: null,
        temperatureMin: 18,
        temperatureMax: 24,
        humidityMin: 40,
        humidityMax: 60,
        pressureMin: null,
        pressureMax: null,
      }),
    ).resolves.toMatchObject({
      message: "Limites ambientais atualizados",
      data: { id: 15 },
    });
    await expect(client.environmentalLimits.delete(15)).resolves.toEqual({
      message: "Limites removidos",
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/environmental-limits",
      "https://api.example.test/api/environmental-limits",
      "https://api.example.test/api/environmental-limits/15",
    ]);
  });

  it("reads desktop environmental limits from the local session", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        data: {
          serverTime: "2026-05-09T12:00:00.000Z",
          user: { id: "user-1", name: "Ana", email: "ana@example.test" },
          organization: { id: "org-1", type: "laboratory" },
          activeUnits: [{ id: 10, name: "Central", role: "unit_admin" }],
          permissions: {
            role: "member",
            unitRole: "unit_admin",
            activeUnitId: 10,
            accessibleUnitIds: [10],
            canAccessAllUnits: false,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: "cursor-1",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [
            {
              id: 15,
              unitId: 10,
              assetTypeId: null,
              temperatureMin: 18,
              temperatureMax: 24,
            },
          ],
          jobs: [],
          serviceOrders: [],
        },
      });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await expect(client.environmentalLimits.list()).resolves.toMatchObject({
      limits: [{ id: 15, unitId: 10, temperatureMax: 24 }],
      unit: { unitId: 10, unitName: "Central" },
    });
    await expect(
      client.environmentalLimits.save({
        assetTypeId: null,
        temperatureMin: null,
        temperatureMax: null,
        humidityMin: null,
        humidityMax: null,
        pressureMin: null,
        pressureMax: null,
      }),
    ).rejects.toThrow("Limites ambientais requer a API web/nuvem");
    expect(String(fetchCalls[0]?.[0])).toBe(
      "http://127.0.0.1:4317/api/local/session",
    );
  });

  it("shares desktop local session reads across adapters", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        data: {
          serverTime: "2026-05-09T12:00:00.000Z",
          user: { id: "user-1", name: "Ana", email: "ana@example.test" },
          organization: { id: "org-1", type: "laboratory" },
          activeUnits: [{ id: 10, name: "Central", role: "unit_admin" }],
          permissions: {
            role: "member",
            unitRole: "unit_admin",
            activeUnitId: 10,
            accessibleUnitIds: [10],
            canAccessAllUnits: false,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: "cursor-1",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [],
          jobs: [],
          serviceOrders: [],
        },
      });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await Promise.all([
      client.sync.getSession(),
      client.units.getDashboardUnits(),
      client.environmentalLimits.list(),
    ]);

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
    ]);
  });
});

describe("integrations runtime adapter", () => {
  it("routes integration operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/sync/preview")) {
        return Response.json({ target: "customer", previewCount: 1 });
      }

      if (url.endsWith("/conta-azul/oauth/start")) {
        return Response.json({
          authorizationUrl: "https://auth.example.test/oauth",
        });
      }

      if (url.endsWith("/conta-azul/catalog/accounts")) {
        return Response.json({ items: [{ id: "account-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/balances")) {
        return Response.json({ items: [{ id: "account-1", balance: 1200 }] });
      }

      if (url.endsWith("/conta-azul/catalog/categories")) {
        return Response.json({ items: [{ id: "category-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/cost-centers")) {
        return Response.json({ items: [{ id: "cost-center-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/product-categories")) {
        return Response.json({ items: [{ id: "product-category-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/product-cest")) {
        return Response.json({ items: [{ id: "cest-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/products")) {
        return Response.json({ items: [{ id: "product-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/product-ncm")) {
        return Response.json({ items: [{ id: "ncm-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/product-units")) {
        return Response.json({ items: [{ id: "unit-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/product-ecommerce-categories")) {
        return Response.json({ items: [{ id: "ecommerce-category-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/product-ecommerce-brands")) {
        return Response.json({ items: [{ id: "ecommerce-brand-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/services")) {
        return Response.json({ items: [{ id: "service-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/sellers")) {
        return Response.json({ items: [{ id: "seller-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/dre-categories")) {
        return Response.json({ items: [{ id: "dre-1" }] });
      }

      if (url.endsWith("/conta-azul/catalog/transfers")) {
        return Response.json({ items: [{ id: "transfer-1" }] });
      }

      if (url.endsWith("/conta-azul/poll")) {
        return Response.json({ scanned: 1 });
      }

      if (url.endsWith("/conta-azul/poll-fiscal")) {
        return Response.json({ scannedFiscalDocuments: 1 });
      }

      if (url.endsWith("/conta-azul/link-mdfe")) {
        return Response.json({ remoteEntityId: "MDFE-345345" });
      }

      if (url.endsWith("/conta-azul/poll-payables")) {
        return Response.json({ scannedPayables: 1 });
      }

      if (url.endsWith("/conta-azul/poll-protocols")) {
        return Response.json({ scannedProtocols: 1 });
      }

      if (url.endsWith("/conta-azul/poll-drift")) {
        return Response.json({ scannedDriftLinks: 1 });
      }

      if (url.endsWith("/conta-azul/schedule")) {
        return Response.json({
          paymentStatusPolling: {
            enabled: true,
            intervalMinutes: 30,
            lastErrorAt: null,
            lastErrorMessage: null,
            lastSuccessAt: "2026-05-26T12:00:00.000Z",
            nextDueAt: "2026-05-26T12:30:00.000Z",
          },
        });
      }

      if (url.endsWith("/conta-azul/refresh")) {
        return Response.json({ refreshed: true });
      }

      if (url.endsWith("/conta-azul/disconnect")) {
        return Response.json({ disconnected: true });
      }

      if (url.endsWith("/runs/run-1/retry")) {
        return Response.json({ queued: true });
      }

      if (url.endsWith("/runs/run-1/items")) {
        return Response.json({
          data: [{ id: "item-1", status: "FAILED" }],
          summary: { returnedCount: 1 },
        });
      }

      if (url.endsWith("/validate")) {
        return Response.json({ ok: true });
      }

      if (url.endsWith("/toggle")) {
        return Response.json({ status: "DISABLED" });
      }

      if (url.endsWith("/sync")) {
        return Response.json({ queued: true });
      }

      if (url.endsWith("/schedule")) {
        return Response.json({ schedule: { mode: "manual" } });
      }

      if (init?.method === "POST") {
        return Response.json({ id: "integration-1" }, { status: 201 });
      }

      if (init?.method === "PUT") {
        return Response.json({ id: "integration-1", updated: true });
      }

      return Response.json({
        billing: { hasFinancialIntegrations: true },
        data: [{ id: "integration-1" }],
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.integrations.list()).resolves.toMatchObject({
      data: [{ id: "integration-1" }],
    });
    await expect(client.integrations.create({ name: "ERP" })).resolves.toEqual({
      id: "integration-1",
    });
    await expect(
      client.integrations.startContaAzulOAuth({
        returnTo: "/dashboard/settings/integrations",
      }),
    ).resolves.toMatchObject({
      authorizationUrl: "https://auth.example.test/oauth",
    });
    await expect(
      client.integrations.validate("integration-1"),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.integrations.update("integration-1", { mappings: {} }),
    ).resolves.toMatchObject({ updated: true });
    await expect(
      client.integrations.updateContaAzulConfig("integration-1", {
        defaultFinancialAccountId: "account-1",
      }),
    ).resolves.toMatchObject({ updated: true });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "accounts"),
    ).resolves.toMatchObject({ items: [{ id: "account-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "balances"),
    ).resolves.toMatchObject({
      items: [{ id: "account-1", balance: 1200 }],
    });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "categories"),
    ).resolves.toMatchObject({ items: [{ id: "category-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "cost-centers"),
    ).resolves.toMatchObject({ items: [{ id: "cost-center-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog(
        "integration-1",
        "product-categories",
      ),
    ).resolves.toMatchObject({ items: [{ id: "product-category-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "product-cest"),
    ).resolves.toMatchObject({ items: [{ id: "cest-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "products"),
    ).resolves.toMatchObject({ items: [{ id: "product-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "product-ncm"),
    ).resolves.toMatchObject({ items: [{ id: "ncm-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog(
        "integration-1",
        "product-units",
      ),
    ).resolves.toMatchObject({ items: [{ id: "unit-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog(
        "integration-1",
        "product-ecommerce-categories",
      ),
    ).resolves.toMatchObject({ items: [{ id: "ecommerce-category-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog(
        "integration-1",
        "product-ecommerce-brands",
      ),
    ).resolves.toMatchObject({ items: [{ id: "ecommerce-brand-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "services"),
    ).resolves.toMatchObject({ items: [{ id: "service-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "sellers"),
    ).resolves.toMatchObject({ items: [{ id: "seller-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog(
        "integration-1",
        "dre-categories",
      ),
    ).resolves.toMatchObject({ items: [{ id: "dre-1" }] });
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "transfers"),
    ).resolves.toMatchObject({ items: [{ id: "transfer-1" }] });
    await expect(
      client.integrations.pollContaAzul("integration-1", { limit: 100 }),
    ).resolves.toMatchObject({ scanned: 1 });
    await expect(
      client.integrations.pollContaAzulFiscal("integration-1", { limit: 100 }),
    ).resolves.toMatchObject({ scannedFiscalDocuments: 1 });
    await expect(
      client.integrations.linkContaAzulInvoicesToMdfe("integration-1", {
        externalId: "mdfe:1",
        fiscalDocumentAccessKeys: [
          "42250323643586000108550010000001151606401726",
        ],
        mdfeIdentifier: "MDFE-345345",
        status: "ENCERRADO",
      }),
    ).resolves.toMatchObject({ remoteEntityId: "MDFE-345345" });
    await expect(
      client.integrations.pollContaAzulPayables("integration-1", {
        limit: 100,
      }),
    ).resolves.toMatchObject({ scannedPayables: 1 });
    await expect(
      client.integrations.pollContaAzulProtocols("integration-1", {
        limit: 100,
      }),
    ).resolves.toMatchObject({ scannedProtocols: 1 });
    await expect(
      client.integrations.pollContaAzulDrift("integration-1", { limit: 100 }),
    ).resolves.toMatchObject({ scannedDriftLinks: 1 });
    await expect(
      client.integrations.getContaAzulSchedule("integration-1"),
    ).resolves.toMatchObject({
      paymentStatusPolling: {
        enabled: true,
      },
    });
    await expect(
      client.integrations.refreshContaAzul("integration-1"),
    ).resolves.toMatchObject({ refreshed: true });
    await expect(
      client.integrations.disconnectContaAzul("integration-1"),
    ).resolves.toMatchObject({ disconnected: true });
    await expect(
      client.integrations.toggle("integration-1", { enabled: false }),
    ).resolves.toMatchObject({ status: "DISABLED" });
    await expect(
      client.integrations.previewSync("integration-1", { target: "customer" }),
    ).resolves.toMatchObject({ previewCount: 1 });
    await expect(
      client.integrations.sync("integration-1", { target: "customer" }),
    ).resolves.toMatchObject({ queued: true });
    await expect(
      client.integrations.schedule("integration-1", { mode: "manual" }),
    ).resolves.toMatchObject({ schedule: { mode: "manual" } });
    await expect(
      client.integrations.listRunItems("integration-1", "run-1"),
    ).resolves.toMatchObject({
      data: [{ id: "item-1", status: "FAILED" }],
      summary: { returnedCount: 1 },
    });
    await expect(
      client.integrations.retryRun("integration-1", "run-1"),
    ).resolves.toMatchObject({ queued: true });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/integrations",
      "https://api.example.test/api/integrations",
      "https://api.example.test/api/integrations/conta-azul/oauth/start",
      "https://api.example.test/api/integrations/integration-1/validate",
      "https://api.example.test/api/integrations/integration-1",
      "https://api.example.test/api/integrations/integration-1/conta-azul/config",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/accounts",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/balances",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/categories",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/cost-centers",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/product-categories",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/product-cest",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/products",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/product-ncm",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/product-units",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/product-ecommerce-categories",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/product-ecommerce-brands",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/services",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/sellers",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/dre-categories",
      "https://api.example.test/api/integrations/integration-1/conta-azul/catalog/transfers",
      "https://api.example.test/api/integrations/integration-1/conta-azul/poll",
      "https://api.example.test/api/integrations/integration-1/conta-azul/poll-fiscal",
      "https://api.example.test/api/integrations/integration-1/conta-azul/link-mdfe",
      "https://api.example.test/api/integrations/integration-1/conta-azul/poll-payables",
      "https://api.example.test/api/integrations/integration-1/conta-azul/poll-protocols",
      "https://api.example.test/api/integrations/integration-1/conta-azul/poll-drift",
      "https://api.example.test/api/integrations/integration-1/conta-azul/schedule",
      "https://api.example.test/api/integrations/integration-1/conta-azul/refresh",
      "https://api.example.test/api/integrations/integration-1/conta-azul/disconnect",
      "https://api.example.test/api/integrations/integration-1/toggle",
      "https://api.example.test/api/integrations/integration-1/sync/preview",
      "https://api.example.test/api/integrations/integration-1/sync",
      "https://api.example.test/api/integrations/integration-1/schedule",
      "https://api.example.test/api/integrations/integration-1/runs/run-1/items",
      "https://api.example.test/api/integrations/integration-1/runs/run-1/retry",
    ]);
  });

  it("keeps integration mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.integrations.list()).resolves.toMatchObject({
      billing: { hasFinancialIntegrations: false },
      data: [],
    });
    await expect(client.integrations.create({ name: "ERP" })).rejects.toThrow(
      "Integrações requer a API web/nuvem",
    );
    await expect(client.integrations.startContaAzulOAuth({})).rejects.toThrow(
      "Integrações requer a API web/nuvem",
    );
    await expect(
      client.integrations.updateContaAzulConfig("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.listContaAzulCatalog("integration-1", "accounts"),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.pollContaAzul("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.pollContaAzulFiscal("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.linkContaAzulInvoicesToMdfe("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.pollContaAzulPayables("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.pollContaAzulProtocols("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.pollContaAzulDrift("integration-1", {}),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.getContaAzulSchedule("integration-1"),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.refreshContaAzul("integration-1"),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.disconnectContaAzul("integration-1"),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
    await expect(
      client.integrations.listRunItems("integration-1", "run-1"),
    ).rejects.toThrow("Integrações requer a API web/nuvem");
  });
});

describe("certificate numbering runtime adapter", () => {
  it("loads and updates certificate numbering through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const profile = {
      id: 12,
      name: "Padrao",
      config: {
        labCode: "LAB",
        projectCode: null,
        numberTemplate: "{labCode}-{yyyy}-{seq}",
        certificateNameTemplate: "Certificado {number}",
        sequence: {
          resetScope: "year" as const,
          startAt: 1,
          increment: 1,
          padding: 4,
        },
      },
      createdAt: "2026-05-09T12:00:00.000Z",
      updatedAt: "2026-05-09T12:00:00.000Z",
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "PUT") {
        return Response.json({
          message: "Perfil de numeracao atualizado",
          profile,
        });
      }

      return Response.json({
        profile,
        example: {
          number: "LAB-2026-0123",
          name: "Certificado LAB-2026-0123",
          sequenceKey: "year:2026",
        },
        supportedTokens: ["{labCode}", "{yyyy}", "{seq}", "{number}"],
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.certificateNumbering.getProfile(),
    ).resolves.toMatchObject({
      profile: { id: 12, config: { labCode: "LAB" } },
      example: { number: "LAB-2026-0123" },
    });
    await expect(
      client.certificateNumbering.updateProfile({
        name: "Padrao",
        config: profile.config,
      }),
    ).resolves.toMatchObject({
      message: "Perfil de numeracao atualizado",
      profile: { id: 12 },
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/certificate-numbering",
      "https://api.example.test/api/certificate-numbering",
    ]);
    expect(fetchCalls[1]?.[1]?.method).toBe("PUT");
  });

  it("exposes a read-only desktop certificate numbering profile", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(
      client.certificateNumbering.getProfile(),
    ).resolves.toMatchObject({
      profile: { id: null, config: { labCode: "CAL" } },
      example: { number: "CAL-2026-0123" },
    });
    await expect(
      client.certificateNumbering.updateProfile({
        name: "Padrao",
        config: {
          labCode: "LAB",
          projectCode: null,
          numberTemplate: "{labCode}-{yyyy}-{seq}",
          certificateNameTemplate: "Certificado {number}",
          sequence: {
            resetScope: "year",
            startAt: 1,
            increment: 1,
            padding: 4,
          },
        },
      }),
    ).rejects.toThrow("Numeração de certificados requer a API web/nuvem");
  });
});

describe("portal domains runtime adapter", () => {
  it("routes portal domain operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const payload = {
      portalBaseUrl: "https://portal.example.test",
      domain: {
        id: "domain-1",
        hostname: "portal.lab.example.test",
        verifiedAt: null,
        activatedAt: null,
        lastVerifiedAt: null,
        isActive: false,
        verification: {
          type: "TXT" as const,
          host: "_calibrafacil.portal.lab.example.test",
          value: "verify-token",
        },
      },
      statusSummary: {
        status: "waiting_dns" as const,
        readiness: "not_ready" as const,
        canActivate: false,
        message: "Aguardando DNS",
        diagnostics: {
          host: "_calibrafacil.portal.lab.example.test",
          expectedValue: "verify-token",
          observedValues: [],
        },
      },
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return Response.json(payload);
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.portalDomains.get()).resolves.toMatchObject({
      domain: { hostname: "portal.lab.example.test" },
    });
    await expect(
      client.portalDomains.create({ hostname: "portal.lab.example.test" }),
    ).resolves.toMatchObject({ domain: { id: "domain-1" } });
    await expect(client.portalDomains.verify()).resolves.toMatchObject({
      statusSummary: { status: "waiting_dns" },
    });
    await expect(client.portalDomains.activate()).resolves.toMatchObject({
      portalBaseUrl: "https://portal.example.test",
    });
    await expect(client.portalDomains.delete()).resolves.toBeUndefined();

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/portal-domains",
      "https://api.example.test/api/portal-domains",
      "https://api.example.test/api/portal-domains/verify",
      "https://api.example.test/api/portal-domains/activate",
      "https://api.example.test/api/portal-domains",
    ]);
  });

  it("keeps portal domain mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.portalDomains.get()).resolves.toMatchObject({
      domain: null,
      statusSummary: { status: "not_configured" },
    });
    await expect(
      client.portalDomains.create({ hostname: "portal.lab.example.test" }),
    ).rejects.toThrow("Domínio do portal requer a API web/nuvem");
    await expect(client.portalDomains.verify()).rejects.toThrow(
      "Domínio do portal requer a API web/nuvem",
    );
    await expect(client.portalDomains.activate()).rejects.toThrow(
      "Domínio do portal requer a API web/nuvem",
    );
    await expect(client.portalDomains.delete()).rejects.toThrow(
      "Domínio do portal requer a API web/nuvem",
    );
  });
});

describe("email domains runtime adapter", () => {
  it("routes email-domain operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const payload = {
      domain: {
        id: "emaildom-1",
        mode: "byok" as const,
        hostname: "mail.lab.example.test",
        fromAddress: "os@mail.lab.example.test",
        status: "verified",
        verifiedAt: null,
        lastVerifiedAt: null,
        activatedAt: null,
        isActive: false,
        keyStatus: "ok" as const,
        keyLastError: null,
        apiKeyMasked: "\u2022\u2022\u2022\u20221234",
        dnsRecords: [],
        createdAt: "2026-07-15T00:00:00.000Z",
      },
      statusSummary: {
        status: "verified" as const,
        canActivate: true,
        message: "Pronto para ativar",
        keyHealth: { status: "ok" as const, lastError: null },
      },
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (String(input).endsWith("/validate-key")) {
        return Response.json({
          valid: true,
          domains: [
            { id: "rd-1", name: "mail.lab.example.test", status: "verified" },
          ],
        });
      }

      return Response.json(payload);
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.emailDomains.get()).resolves.toMatchObject({
      domain: { hostname: "mail.lab.example.test" },
    });
    await expect(
      client.emailDomains.validateKey({ apiKey: "re_key" }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      client.emailDomains.create({
        apiKey: "re_key",
        resendDomainId: "rd-1",
        fromLocalPart: "os",
      }),
    ).resolves.toMatchObject({ domain: { id: "emaildom-1" } });
    await expect(
      client.emailDomains.rotateKey({ apiKey: "re_key2" }),
    ).resolves.toMatchObject({ domain: { id: "emaildom-1" } });
    await expect(client.emailDomains.verify()).resolves.toMatchObject({
      statusSummary: { status: "verified" },
    });
    await expect(client.emailDomains.activate()).resolves.toMatchObject({
      statusSummary: { canActivate: true },
    });
    await expect(client.emailDomains.delete()).resolves.toBeUndefined();

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/email-domains",
      "https://api.example.test/api/email-domains/validate-key",
      "https://api.example.test/api/email-domains",
      "https://api.example.test/api/email-domains/key",
      "https://api.example.test/api/email-domains/verify",
      "https://api.example.test/api/email-domains/activate",
      "https://api.example.test/api/email-domains",
    ]);
  });

  it("keeps email-domain mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.emailDomains.get()).resolves.toMatchObject({
      domain: null,
      statusSummary: { status: "not_configured" },
    });
    await expect(
      client.emailDomains.validateKey({ apiKey: "re_key" }),
    ).rejects.toThrow("Domínio de e-mail requer a API web/nuvem");
    await expect(
      client.emailDomains.create({
        apiKey: "re_key",
        resendDomainId: "rd-1",
        fromLocalPart: "os",
      }),
    ).rejects.toThrow("Domínio de e-mail requer a API web/nuvem");
    await expect(client.emailDomains.verify()).rejects.toThrow(
      "Domínio de e-mail requer a API web/nuvem",
    );
    await expect(client.emailDomains.activate()).rejects.toThrow(
      "Domínio de e-mail requer a API web/nuvem",
    );
    await expect(client.emailDomains.delete()).rejects.toThrow(
      "Domínio de e-mail requer a API web/nuvem",
    );
  });
});

describe("notifications runtime adapter", () => {
  it("routes notification operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/notifications/unread-count")) {
        return Response.json({ count: 3 });
      }

      if (url.includes("/api/notifications?page=1&limit=5")) {
        return Response.json({
          data: [
            {
              id: 1,
              type: "JOB_ASSIGNED",
              priority: "NORMAL",
              status: "UNREAD",
              title: "Job atribuido",
              message: "Um job foi atribuido a voce.",
              actionUrl: "/dashboard/jobs/1",
              createdAt: "2026-05-09T12:00:00.000Z",
            },
          ],
          pagination: {
            page: 1,
            limit: 5,
            total: 1,
            totalPages: 1,
          },
        });
      }

      if (url.endsWith("/api/notifications/mark-read")) {
        return Response.json({ updatedIds: [1] });
      }

      if (url.endsWith("/api/notifications/preferences")) {
        if (init?.method === "PUT") {
          return Response.json({
            preferences: {
              JOB_ASSIGNED: { inApp: true, email: false },
            },
            emailEnabled: false,
            notifySelfActions: true,
            digestFrequency: "NONE",
          });
        }

        return Response.json({
          preferences: {},
          emailEnabled: true,
          notifySelfActions: false,
          digestFrequency: "NONE",
        });
      }

      return Response.json({ count: 1 });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.notifications.getUnreadCount()).resolves.toEqual({
      count: 3,
    });
    await expect(
      client.notifications.listRecent({ page: 1, limit: 5 }),
    ).resolves.toMatchObject({ data: [{ id: 1, status: "UNREAD" }] });
    await expect(client.notifications.markRead([1])).resolves.toMatchObject({
      updatedIds: [1],
    });
    await expect(client.notifications.markAllRead()).resolves.toMatchObject({
      count: 1,
    });
    await expect(client.notifications.getPreferences()).resolves.toMatchObject({
      emailEnabled: true,
      digestFrequency: "NONE",
    });
    await expect(
      client.notifications.updatePreferences({
        emailEnabled: false,
        notifySelfActions: true,
      }),
    ).resolves.toMatchObject({
      emailEnabled: false,
      notifySelfActions: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/notifications/unread-count",
      "https://api.example.test/api/notifications?page=1&limit=5",
      "https://api.example.test/api/notifications/mark-read",
      "https://api.example.test/api/notifications/mark-all-read",
      "https://api.example.test/api/notifications/preferences",
      "https://api.example.test/api/notifications/preferences",
    ]);
  });

  it("returns empty desktop notifications without calling fetch", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.notifications.getUnreadCount()).resolves.toEqual({
      count: 0,
    });
    await expect(client.notifications.listRecent()).resolves.toMatchObject({
      data: [],
      pagination: { total: 0 },
    });
    await expect(client.notifications.markRead([1])).resolves.toMatchObject({
      updatedIds: [],
    });
    await expect(client.notifications.markAllRead()).resolves.toMatchObject({
      count: 0,
    });
    await expect(client.notifications.getPreferences()).resolves.toMatchObject({
      preferences: {},
      emailEnabled: false,
    });
    await expect(
      client.notifications.updatePreferences({
        emailEnabled: true,
      }),
    ).resolves.toMatchObject({
      preferences: {},
      emailEnabled: true,
    });
  });
});

describe("signatures runtime adapter", () => {
  it("routes signature operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "POST") {
        return Response.json({
          message: "Assinatura enviada com sucesso",
          dimensions: { width: 400, height: 150 },
        });
      }

      if (init?.method === "DELETE") {
        return Response.json({ message: "Assinatura removida com sucesso" });
      }

      return Response.json({
        hasSignature: true,
        url: "https://files.example.test/signature.png",
        dimensions: { width: 400, height: 150 },
        uploadedAt: "2026-05-09T12:00:00.000Z",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "10",
      fetch: fetchMock,
    });
    const signatureFile = new Blob(["png"], { type: "image/png" });

    await expect(client.signatures.getMine()).resolves.toMatchObject({
      hasSignature: true,
      url: "https://files.example.test/signature.png",
    });
    await expect(
      client.signatures.uploadMine(signatureFile, {
        fileName: "signature.png",
      }),
    ).resolves.toMatchObject({
      dimensions: { width: 400, height: 150 },
    });
    await expect(client.signatures.deleteMine()).resolves.toMatchObject({
      message: "Assinatura removida com sucesso",
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/signatures/my-signature",
      "https://api.example.test/api/signatures/my-signature",
      "https://api.example.test/api/signatures/my-signature",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["10", "10", "10"]);
    expect(fetchCalls[1]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[1]?.[1]).get("signature")).toBeInstanceOf(
      Blob,
    );
  });

  it("keeps visual signatures cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.signatures.getMine()).resolves.toEqual({
      hasSignature: false,
    });
    await expect(
      client.signatures.uploadMine(new Blob(["png"], { type: "image/png" })),
    ).rejects.toThrow("Assinatura visual requer sincronização com a nuvem");
    await expect(client.signatures.deleteMine()).rejects.toThrow(
      "Assinatura visual requer sincronização com a nuvem",
    );
  });
});

describe("profile media runtime adapter", () => {
  it("routes avatar media operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return Response.json({ success: true });
      }

      return Response.json({
        imageUrl: "https://api.example.test/api/profile-media/avatar",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "20",
      fetch: fetchMock,
    });
    const avatarFile = new Blob(["avatar"], { type: "image/webp" });

    await expect(
      client.profileMedia.uploadAvatar(avatarFile, {
        fileName: "avatar.webp",
      }),
    ).resolves.toEqual({
      imageUrl: "https://api.example.test/api/profile-media/avatar",
    });
    await expect(client.profileMedia.deleteAvatar()).resolves.toEqual({
      success: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/profile-media/avatar",
      "https://api.example.test/api/profile-media/avatar",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["20", "20"]);
    expect(fetchCalls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[0]?.[1]).get("avatar")).toBeInstanceOf(Blob);
  });

  it("keeps avatar media cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(
      client.profileMedia.uploadAvatar(
        new Blob(["avatar"], { type: "image/png" }),
      ),
    ).rejects.toThrow("Avatar requer sincronização com a nuvem");
    await expect(client.profileMedia.deleteAvatar()).rejects.toThrow(
      "Avatar requer sincronização com a nuvem",
    );
  });
});

describe("organization media runtime adapter", () => {
  it("routes organization logo media operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return Response.json({ logoUrl: null });
      }

      return Response.json({
        logoUrl: "https://api.example.test/api/organization-media/logo",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "20",
      fetch: fetchMock,
    });
    const logoFile = new Blob(["logo"], { type: "image/png" });

    await expect(
      client.organizationMedia.uploadLogo(logoFile, {
        fileName: "logo.png",
      }),
    ).resolves.toEqual({
      logoUrl: "https://api.example.test/api/organization-media/logo",
    });
    await expect(client.organizationMedia.deleteLogo()).resolves.toEqual({
      logoUrl: null,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/organization-media/logo",
      "https://api.example.test/api/organization-media/logo",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["20", "20"]);
    expect(fetchCalls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[0]?.[1]).get("logo")).toBeInstanceOf(Blob);
  });

  it("keeps organization logo media cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(
      client.organizationMedia.uploadLogo(
        new Blob(["logo"], { type: "image/png" }),
      ),
    ).rejects.toThrow("Logo da organização requer sincronização com a nuvem");
    await expect(client.organizationMedia.deleteLogo()).rejects.toThrow(
      "Logo da organização requer sincronização com a nuvem",
    );
  });
});

describe("signing certificates runtime adapter", () => {
  it("routes signing certificate operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/set-default")) {
        return Response.json({ message: "Certificado definido como padrão" });
      }

      if (init?.method === "DELETE") {
        return Response.json({
          message: "Certificado revogado com sucesso",
        });
      }

      if (init?.method === "POST") {
        return Response.json({
          message: "Certificado adicionado com sucesso",
          certificate: {
            id: 1,
            unitId: 10,
            name: "Certificado Principal",
            serialNumber: "ABC123",
            issuerCn: "ICP-Brasil",
            subjectCn: "Calibra Facil",
            validFrom: "2026-01-01T00:00:00.000Z",
            validUntil: "2027-01-01T00:00:00.000Z",
            isDefault: true,
          },
        });
      }

      return Response.json({
        certificates: [
          {
            id: 1,
            unitId: 10,
            name: "Certificado Principal",
            serialNumber: "ABC123",
            issuerCn: "ICP-Brasil",
            subjectCn: "Calibra Facil",
            subjectCpfCnpj: null,
            validFrom: "2026-01-01T00:00:00.000Z",
            validUntil: "2027-01-01T00:00:00.000Z",
            isActive: true,
            isDefault: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByName: "Ana",
            revokedAt: null,
            revokedReason: null,
            status: "valid",
          },
        ],
        unit: { unitId: 10 },
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.signingCertificates.list()).resolves.toMatchObject({
      certificates: [{ id: 1, status: "valid" }],
    });
    await expect(
      client.signingCertificates.upload({
        name: "Certificado Principal",
        p12Base64: "base64",
        password: "secret",
        setAsDefault: true,
      }),
    ).resolves.toMatchObject({
      certificate: { id: 1, isDefault: true },
    });
    await expect(client.signingCertificates.setDefault(1)).resolves.toEqual({
      message: "Certificado definido como padrão",
    });
    await expect(
      client.signingCertificates.revoke(1, "Rotacao de certificado"),
    ).resolves.toEqual({
      message: "Certificado revogado com sucesso",
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/signing/certificates",
      "https://api.example.test/api/signing/certificates",
      "https://api.example.test/api/signing/certificates/1/set-default",
      "https://api.example.test/api/signing/certificates/1",
    ]);
  });

  it("keeps signing certificate mutations cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.signingCertificates.list()).resolves.toEqual({
      certificates: [],
    });
    await expect(
      client.signingCertificates.upload({
        name: "Certificado",
        p12Base64: "base64",
        password: "secret",
        setAsDefault: true,
      }),
    ).rejects.toThrow("Certificado ICP-Brasil requer sincronização");
    await expect(client.signingCertificates.setDefault(1)).rejects.toThrow(
      "Certificado ICP-Brasil requer sincronização",
    );
    await expect(
      client.signingCertificates.revoke(1, "Rotacao"),
    ).rejects.toThrow("Certificado ICP-Brasil requer sincronização");
  });
});
