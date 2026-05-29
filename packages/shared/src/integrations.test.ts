import { describe, expect, it } from "vitest";
import {
  getProviderCapabilities,
  INTEGRATION_PROVIDER_CAPABILITIES,
  INTEGRATION_PROVIDER_CAPABILITY_FLAGS,
  providerSupports,
  type IntegrationProvider,
} from "./integrations";

const providers = [
  "generic_http",
  "conta_azul",
] as const satisfies readonly IntegrationProvider[];

describe("integration provider capabilities", () => {
  it("defines every capability flag for every provider", () => {
    for (const provider of providers) {
      expect(
        Object.keys(INTEGRATION_PROVIDER_CAPABILITIES[provider]).toSorted(),
      ).toEqual([...INTEGRATION_PROVIDER_CAPABILITY_FLAGS].toSorted());
    }
  });

  it("keeps generic HTTP as an export-only connector", () => {
    expect(getProviderCapabilities("generic_http")).toMatchObject({
      canCreateCustomers: true,
      canCreateReceivables: true,
      canCreatePayables: false,
      canReadReceivableStatus: false,
      canReadFiscalDocuments: false,
      canUseWebhooks: false,
      requiresPolling: false,
    });
  });

  it("describes the implemented Conta Azul adapter surface", () => {
    const capabilities = getProviderCapabilities("conta_azul");

    expect(capabilities).toMatchObject({
      canCreateCustomers: true,
      canCreateSuppliers: true,
      canCreateTransporters: true,
      canCreateCatalogItems: true,
      canCreateBudgets: true,
      canCreateSales: true,
      canCreateReceivables: true,
      canCreatePayables: true,
      canCreateContracts: true,
      canReadReceivableStatus: true,
      canReadInstallments: true,
      canReadPayableStatus: true,
      canReadFiscalDocuments: true,
      canIssueFiscalDocuments: false,
      canReadRemoteDocumentLinks: true,
      canSyncContracts: true,
      canUseWebhooks: false,
      requiresPolling: true,
      supportsCostCenters: true,
      supportsCategories: true,
      supportsRateio: false,
      supportsSellers: true,
      supportsBranchAddresses: false,
    });
  });

  it("checks individual capability flags without exposing mutable registry state", () => {
    const capabilities = getProviderCapabilities("conta_azul");
    capabilities.canUseWebhooks = true;

    expect(providerSupports("conta_azul", "canUseWebhooks")).toBe(false);
    expect(providerSupports("conta_azul", "requiresPolling")).toBe(true);
  });
});
