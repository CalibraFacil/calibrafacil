import { describe, expect, it } from "vitest";
import {
  getProviderCapabilities,
  INTEGRATION_PROVIDER_CAPABILITIES,
  INTEGRATION_PROVIDER_CAPABILITY_FLAGS,
  normalizeIntegrationBaseUrl,
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

describe("normalizeIntegrationBaseUrl (early validation at save time)", () => {
  it("keeps a public https base URL, dropping the trailing slash", () => {
    expect(normalizeIntegrationBaseUrl(" https://erp.example.com/api/ ")).toBe(
      "https://erp.example.com/api",
    );
  });

  it.each([
    "https://localhost/",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://172.20.1.1/",
    "https://192.168.0.1/",
    "https://169.254.169.254/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://2130706433/",
  ])("refuses the private literal %s", (url) => {
    expect(() => normalizeIntegrationBaseUrl(url)).toThrow();
  });

  it("refuses credentials, a query string and other schemes", () => {
    expect(() =>
      normalizeIntegrationBaseUrl("https://u:p@a.example/"),
    ).toThrow();
    expect(() =>
      normalizeIntegrationBaseUrl("https://a.example/?x=1"),
    ).toThrow();
    expect(() => normalizeIntegrationBaseUrl("ftp://a.example/")).toThrow();
  });
});
