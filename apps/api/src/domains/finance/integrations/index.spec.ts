import { describe, expect, it } from "vitest";
import * as integrations from "./index";

// REQ-SPLIT-2: every runtime name the callers (routes, worker entry points,
// tests) import comes out of the index, and nothing else leaks.
// The type half (IntegrationOverview, IntegrationsEnv) is held by `check-types`
// on the callers that import them.
const CALLER_SURFACE = [
  "adjustMaterialErpStock",
  "buildContaAzulReferenceLink",
  "buildContaAzulReferenceLinks",
  "buildDependencyWarnings",
  "buildEmptyRemoteDocumentSummary",
  "buildGenericConnectionConfig",
  "buildInitialNextScheduledRunAt",
  "buildIntegrationOverview",
  "createIntegrationPayloadFingerprint",
  "createSyncRun",
  "decryptIntegrationSecret",
  "dispatchContaAzulSync",
  "encryptIntegrationSecret",
  "failIntegrationSyncRun",
  "failSyncRunAsBlocked",
  "filterContaAzulCatalogPayloadsByEnabledKinds",
  "getContaAzulReferenceLinkTarget",
  "getContaAzulScheduleState",
  "getIntegrationRecord",
  "getRequestedLimitFromRun",
  "getTargetScheduleConfig",
  "hasActiveSyncRun",
  "isContaAzulFiscalPollingDue",
  "isContaAzulPaymentPollingDue",
  "isContaAzulScheduledSyncDue",
  "linkContaAzulFiscalDocumentsToMdfe",
  "listContaAzulCatalog",
  "listOrganizationIntegrations",
  "loadCatalogItemPayloads",
  "mapServiceOrderToBudgetPayload",
  "mapServiceOrderToSalePayload",
  "markContaAzulReconnectRequired",
  "pollContaAzulBillingStatus",
  "pollContaAzulFiscalDocuments",
  "pollContaAzulPayableStatus",
  "pollContaAzulProtocols",
  "pollContaAzulRemoteDrift",
  "previewIntegrationSync",
  "processScheduledContaAzulIntegrationSyncs",
  "processScheduledContaAzulPolls",
  "runContaAzulScheduledPoll",
  "runIntegrationSync",
  "shouldRefreshContaAzulTokenBeforeUse",
  "summarizeRemoteDocumentLinks",
  "updateTargetScheduleConfig",
  "validateContaAzulConnection",
  "validateGenericConnection",
  "writeIntegrationEvent",
  "writeOrganizationIntegrationEvent",
] as const;

describe("integrations module index", () => {
  it("REQ-SPLIT-2 re-exports exactly the runtime surface callers use", () => {
    expect(Object.keys(integrations).toSorted()).toEqual([...CALLER_SURFACE]);
  });

  it("REQ-SPLIT-2 exports every caller name as a function", () => {
    for (const [name, value] of Object.entries(integrations)) {
      expect(typeof value, name).toBe("function");
    }
  });
});
