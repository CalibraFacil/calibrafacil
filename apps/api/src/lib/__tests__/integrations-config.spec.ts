import { describe, expect, it } from "vitest";
import {
  CONTA_AZUL_SYNC_DOMAINS,
  CONTA_AZUL_API_BASE_URL,
  DEFAULT_CONTA_AZUL_SCOPES,
  normalizeContaAzulConnectionConfig,
  normalizeFinancialErpConnectionConfig,
  normalizeGenericFinancialErpConfig,
  validateIntegrationMappings,
} from "@calibra-facil/shared";
import {
  buildDependencyWarnings,
  isContaAzulFiscalPollingDue,
  isContaAzulPaymentPollingDue,
  isContaAzulScheduledSyncDue,
  buildContaAzulReferenceLink,
  buildContaAzulReferenceLinks,
  createIntegrationPayloadFingerprint,
  getContaAzulReferenceLinkTarget,
  mapServiceOrderToBudgetPayload,
  mapServiceOrderToSalePayload,
  shouldRefreshContaAzulTokenBeforeUse,
  summarizeRemoteDocumentLinks,
} from "../integrations";

const emptyCoverage = {
  catalog_item: {
    target: "catalog_item" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  contract: {
    target: "contract" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  customer: {
    target: "customer" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  supplier: {
    target: "supplier" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  transporter: {
    target: "transporter" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  service_order: {
    target: "service_order" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  billing_document: {
    target: "billing_document" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
  payable: {
    target: "payable" as const,
    localCount: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  },
};

describe("financial ERP integration config", () => {
  it("creates stable fingerprints for sync item idempotency metadata", () => {
    const left = createIntegrationPayloadFingerprint({
      externalId: "bill-1",
      documentNumber: "FAT-1",
      organizationId: "org-1",
      unitId: 1,
      unitName: "Massa",
      customerExternalId: "cust-1",
      customerName: "Cliente Exemplo",
      totalCents: 12345,
      currency: "BRL",
      issueDate: "2026-05-24",
      dueDate: "2026-06-24",
      status: "issued",
      items: [
        {
          lineId: "line-1",
          jobId: "job-1",
          catalogItemExternalId: "service-1",
          description: "Calibracao",
          quantity: 1,
          unitPriceCents: 12345,
          totalCents: 12345,
        },
      ],
    });
    const right = createIntegrationPayloadFingerprint({
      items: [
        {
          totalCents: 12345,
          unitPriceCents: 12345,
          quantity: 1,
          description: "Calibracao",
          catalogItemExternalId: "service-1",
          jobId: "job-1",
          lineId: "line-1",
        },
      ],
      status: "issued",
      dueDate: "2026-06-24",
      issueDate: "2026-05-24",
      currency: "BRL",
      totalCents: 12345,
      customerName: "Cliente Exemplo",
      customerExternalId: "cust-1",
      unitName: "Massa",
      unitId: 1,
      organizationId: "org-1",
      documentNumber: "FAT-1",
      externalId: "bill-1",
    });

    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(right).toBe(left);
  });

  it("preserves generic HTTP normalization behavior", () => {
    const config = normalizeGenericFinancialErpConfig({
      baseUrl: "https://erp.example.com/api/",
      healthPath: "status/",
      customerPath: "people/",
    });

    expect(config).toMatchObject({
      baseUrl: "https://erp.example.com/api",
      healthPath: "/status",
      customerPath: "/people",
      serviceOrderPath: "/service-orders",
      billingDocumentPath: "/billing-documents",
      authType: "bearer",
    });
    expect(config.schedules.customer.mode).toBe("manual_only");
    expect(validateIntegrationMappings(config.mappings)).toEqual([]);
  });

  it("normalizes Conta Azul defaults without generic HTTP fields", () => {
    const config = normalizeContaAzulConnectionConfig();

    expect(config).toMatchObject({
      provider: "conta_azul",
      baseUrl: CONTA_AZUL_API_BASE_URL,
      accountId: null,
      connectedCompanyName: null,
      accessTokenExpiresAt: null,
      defaultFinancialAccountId: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      defaultDreCategoryId: null,
      defaultExpenseCategoryId: null,
      defaultPaymentMethodId: null,
      defaultProductCategoryId: null,
      defaultSellerId: null,
      defaultServiceCategoryId: null,
      defaultUnitOfMeasureId: null,
      budgetMode: "sales_search_link",
      fiscalMode: "consultation_only",
      defaultFiscalTaxonomy: null,
      protocolMode: "api_lookup_verified",
      saleTrigger: "manual",
      exportMode: "receivable_event",
      enabledTargets: {
        customers: true,
        suppliers: false,
        transporters: false,
        services: false,
        products: false,
        inventoryTaxonomy: false,
        budgets: false,
        sellers: true,
        sales: false,
        contracts: false,
        billingDocuments: true,
        receivables: true,
        payables: false,
        expenses: false,
        financialAccounts: true,
        balances: false,
        transfers: false,
        categories: true,
        dreCategories: false,
        costCenters: true,
        baixas: true,
        paymentStatusPolling: true,
        fiscalDocuments: false,
        remoteDocuments: false,
        protocols: false,
        driftChecks: false,
      },
      polling: {
        receivablesLastRemoteUpdatedAt: null,
        payablesLastRemoteUpdatedAt: null,
        invoicesLastRemoteUpdatedAt: null,
        protocolsLastRemoteUpdatedAt: null,
        driftLastCheckedAt: null,
      },
    });
    expect(new Set(Object.keys(config.enabledTargets))).toEqual(
      new Set(CONTA_AZUL_SYNC_DOMAINS),
    );
    expect(config.scopes).toEqual([...DEFAULT_CONTA_AZUL_SCOPES]);
    expect(config.schedules.catalog_item.mode).toBe("manual_only");
    expect(config.schedules.contract.mode).toBe("manual_only");
    expect(config.mappings.catalog_item.fields[0]?.sourceField).toBe(
      "externalId",
    );
    expect(config.mappings.contract.fields[0]?.sourceField).toBe("externalId");
    expect(config.schedules.supplier.mode).toBe("manual_only");
    expect(config.schedules.transporter.mode).toBe("manual_only");
    expect(config.mappings.supplier.fields[0]?.sourceField).toBe("externalId");
    expect(config.mappings.transporter.fields[0]?.sourceField).toBe(
      "externalId",
    );
    expect(config.schedules.payable.mode).toBe("manual_only");
    expect(config.mappings.payable.fields[0]?.sourceField).toBe("externalId");
    expect(config.schedules.billing_document.frequency).toBe("daily");
    expect(validateIntegrationMappings(config.mappings)).toEqual([]);
    expect("healthPath" in config).toBe(false);
  });

  it("refreshes Conta Azul OAuth tokens before expiry", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const tokenBundle = {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      tokenType: "Bearer",
      expiresIn: 3600,
      expiresAt: "2026-05-24T12:04:59.000Z",
      scopes: ["openid"],
    };

    expect(shouldRefreshContaAzulTokenBeforeUse(tokenBundle, now)).toBe(true);
    expect(
      shouldRefreshContaAzulTokenBeforeUse(
        {
          ...tokenBundle,
          expiresAt: "2026-05-24T12:05:01.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldRefreshContaAzulTokenBeforeUse(
        {
          ...tokenBundle,
          expiresAt: "invalid-date",
        },
        now,
      ),
    ).toBe(true);
  });

  it("summarizes Conta Azul remote PDF and fiscal XML document links", () => {
    const summary = summarizeRemoteDocumentLinks([
      {
        metadata: {
          documentKind: "sale_pdf",
          status: "available",
        },
        lastSyncedAt: new Date("2026-05-24T09:00:00.000Z"),
      },
      {
        metadata: {
          documentKind: "fiscal_xml",
          status: "unavailable",
        },
        lastSyncedAt: new Date("2026-05-24T10:00:00.000Z"),
      },
      {
        metadata: {
          documentKind: "receipt_pdf",
          status: "available",
        },
        lastSyncedAt: null,
      },
    ]);

    expect(summary).toEqual({
      totalCount: 3,
      availableCount: 2,
      unavailableCount: 1,
      salePdfCount: 1,
      fiscalXmlCount: 1,
      otherCount: 1,
      lastSyncedAt: "2026-05-24T10:00:00.000Z",
    });
  });

  it("maps Conta Azul financial and catalog references to stable object links", () => {
    expect(getContaAzulReferenceLinkTarget("accounts")).toBe(
      "financial_account",
    );
    expect(getContaAzulReferenceLinkTarget("balances")).toBe(
      "financial_account",
    );
    expect(getContaAzulReferenceLinkTarget("categories")).toBe("category");
    expect(getContaAzulReferenceLinkTarget("costCenters")).toBe("cost_center");
    expect(getContaAzulReferenceLinkTarget("dreCategories")).toBe(
      "dre_category",
    );
    expect(getContaAzulReferenceLinkTarget("transfers")).toBe(
      "financial_transfer",
    );
    expect(getContaAzulReferenceLinkTarget("productCategories")).toBe(
      "catalog_item",
    );
    expect(getContaAzulReferenceLinkTarget("cest")).toBe("catalog_item");
    expect(getContaAzulReferenceLinkTarget("ncm")).toBe("catalog_item");
    expect(getContaAzulReferenceLinkTarget("units")).toBe("catalog_item");
    expect(getContaAzulReferenceLinkTarget("productEcommerceCategories")).toBe(
      "catalog_item",
    );
    expect(getContaAzulReferenceLinkTarget("productEcommerceBrands")).toBe(
      "catalog_item",
    );
    expect(getContaAzulReferenceLinkTarget("products")).toBe("product");
    expect(getContaAzulReferenceLinkTarget("serviceCategories")).toBe("service");
    expect(getContaAzulReferenceLinkTarget("sellers")).toBe("seller");
    expect(getContaAzulReferenceLinkTarget("protocols")).toBeNull();

    expect(
      buildContaAzulReferenceLink({
        domain: "dreCategories",
        fetchedAt: "2026-05-24T12:00:00.000Z",
        item: {
          id: "dre-1",
          name: "Receita operacional",
          code: "1.1",
          active: true,
          metadata: { type: "RECEITA" },
        },
      }),
    ).toEqual({
      target: "dre_category",
      localEntityId: "conta_azul:dreCategories:dre-1",
      remoteEntityId: "dre-1",
      remoteDisplayId: "Receita operacional",
      remoteEntityType: "conta_azul_dre_category",
      metadata: {
        provider: "conta_azul",
        source: "reference_catalog",
        domain: "dreCategories",
        code: "1.1",
        active: true,
        referenceMetadata: { type: "RECEITA" },
        fetchedAt: "2026-05-24T12:00:00.000Z",
      },
    });

    expect(
      buildContaAzulReferenceLink({
        domain: "balances",
        fetchedAt: "2026-05-24T12:00:00.000Z",
        item: {
          id: "account-1",
          name: "Conta corrente",
          code: null,
          active: true,
          metadata: {
            amount: 1234.56,
            financialAccountId: "account-1",
            financialAccountName: "Conta corrente",
            sourceIndex: 0,
            type: "CONTA_CORRENTE",
          },
        },
      }),
    ).toEqual({
      target: "financial_account",
      localEntityId: "conta_azul:balances:account-1",
      remoteEntityId: "account-1",
      remoteDisplayId: "Conta corrente",
      remoteEntityType: "conta_azul_financial_account_balance",
      metadata: {
        provider: "conta_azul",
        source: "reference_catalog",
        domain: "balances",
        code: null,
        active: true,
        referenceMetadata: {
          amount: 1234.56,
          financialAccountId: "account-1",
          financialAccountName: "Conta corrente",
          sourceIndex: 0,
          type: "CONTA_CORRENTE",
        },
        fetchedAt: "2026-05-24T12:00:00.000Z",
      },
    });

    expect(
      buildContaAzulReferenceLink({
        domain: "ncm",
        fetchedAt: "2026-05-24T12:00:00.000Z",
        item: {
          id: "ncm-1",
          name: "Instrumentos e aparelhos de medida",
          code: "90318099",
          active: true,
          metadata: {
            status: "ATIVO",
          },
        },
      }),
    ).toEqual({
      target: "catalog_item",
      localEntityId: "conta_azul:ncm:ncm-1",
      remoteEntityId: "ncm-1",
      remoteDisplayId: "Instrumentos e aparelhos de medida",
      remoteEntityType: "conta_azul_product_ncm",
      metadata: {
        provider: "conta_azul",
        source: "reference_catalog",
        domain: "ncm",
        code: "90318099",
        active: true,
        referenceMetadata: {
          status: "ATIVO",
        },
        fetchedAt: "2026-05-24T12:00:00.000Z",
      },
    });

    expect(
      buildContaAzulReferenceLink({
        domain: "products",
        fetchedAt: "2026-05-24T12:00:00.000Z",
        item: {
          id: "product-1",
          name: "Peso padrão",
          code: "PESO-001",
          active: true,
          metadata: null,
        },
      }),
    ).toMatchObject({
      target: "product",
      localEntityId: "conta_azul:products:product-1",
      remoteEntityId: "product-1",
      remoteEntityType: "conta_azul_product",
    });

    expect(
      buildContaAzulReferenceLinks({
        domain: "serviceCategories",
        fetchedAt: "2026-05-24T12:00:00.000Z",
        item: {
          id: "remote-service-5",
          name: "Calibração dimensional",
          code: "CAL-DIM",
          active: true,
          metadata: {
            externalId: "service:5",
            type: "PRESTADO",
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        target: "service",
        localEntityId: "conta_azul:serviceCategories:remote-service-5",
        remoteEntityId: "remote-service-5",
        remoteEntityType: "conta_azul_service",
        metadata: expect.objectContaining({
          source: "reference_catalog",
        }),
      }),
      expect.objectContaining({
        target: "catalog_item",
        localEntityId: "service:5",
        remoteEntityId: "remote-service-5",
        remoteEntityType: "conta_azul_service",
        metadata: expect.objectContaining({
          consultationOnly: true,
          matchedBy: "id_externo",
          source: "reference_catalog_external_id",
        }),
      }),
    ]);
  });

  it("gates Conta Azul supplier and transporter schedules on enabled domains", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const disabled = normalizeContaAzulConnectionConfig({
      schedules: {
        supplier: {
          mode: "scheduled",
          frequency: "daily",
          nextScheduledRunAt: "2026-05-24T11:00:00.000Z",
          lastScheduledRunAt: null,
        },
        transporter: {
          mode: "scheduled",
          frequency: "daily",
          nextScheduledRunAt: "2026-05-24T11:00:00.000Z",
          lastScheduledRunAt: null,
        },
      },
    });

    expect(
      isContaAzulScheduledSyncDue({
        config: disabled,
        target: "supplier",
        now,
      }),
    ).toBe(false);
    expect(
      isContaAzulScheduledSyncDue({
        config: disabled,
        target: "transporter",
        now,
      }),
    ).toBe(false);

    const enabled = normalizeContaAzulConnectionConfig({
      enabledTargets: {
        suppliers: true,
        transporters: true,
      },
      schedules: disabled.schedules,
    });

    expect(
      isContaAzulScheduledSyncDue({
        config: enabled,
        target: "supplier",
        now,
      }),
    ).toBe(true);
    expect(
      isContaAzulScheduledSyncDue({
        config: enabled,
        target: "transporter",
        now,
      }),
    ).toBe(true);
  });

  it("gates Conta Azul payable schedules on payables or expenses domains", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const scheduledPayable = {
      payable: {
        mode: "scheduled" as const,
        frequency: "daily" as const,
        nextScheduledRunAt: "2026-05-24T11:00:00.000Z",
        lastScheduledRunAt: null,
      },
    };

    expect(
      isContaAzulScheduledSyncDue({
        config: normalizeContaAzulConnectionConfig({
          schedules: scheduledPayable,
        }),
        target: "payable",
        now,
      }),
    ).toBe(false);
    expect(
      isContaAzulScheduledSyncDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            payables: true,
          },
          schedules: scheduledPayable,
        }),
        target: "payable",
        now,
      }),
    ).toBe(true);
    expect(
      isContaAzulScheduledSyncDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            expenses: true,
          },
          schedules: scheduledPayable,
        }),
        target: "payable",
        now,
      }),
    ).toBe(true);
  });

  it("uses provider-aware normalization and preserves expanded Conta Azul modes", () => {
    const generic = normalizeFinancialErpConnectionConfig("generic_http", {
      baseUrl: "https://erp.example.com",
    });
    const contaAzul = normalizeFinancialErpConnectionConfig("conta_azul", {
      exportMode: "sale",
      budgetMode: "native_api_write_verified",
      fiscalMode: "issuance_supported",
      protocolMode: "api_lookup_verified",
      saleTrigger: "quote_approved",
      defaultFiscalTaxonomy: {
        ncm: "90318099",
      },
      enabledTargets: {
        budgets: true,
        fiscalDocuments: true,
        payables: true,
        products: true,
        protocols: true,
        services: true,
        paymentStatusPolling: false,
      },
    });

    expect(generic.baseUrl).toBe("https://erp.example.com");
    expect("provider" in contaAzul && contaAzul.provider).toBe("conta_azul");
    if (!("provider" in contaAzul)) {
      throw new Error("expected Conta Azul config");
    }
    expect(contaAzul.provider).toBe("conta_azul");
    expect(contaAzul.exportMode).toBe("sale");
    expect(contaAzul.budgetMode).toBe("sales_search_link");
    expect(contaAzul.fiscalMode).toBe("consultation_only");
    expect(contaAzul.protocolMode).toBe("api_lookup_verified");
    expect(contaAzul.saleTrigger).toBe("quote_approved");
    expect(contaAzul.defaultFiscalTaxonomy).toEqual({
      ncm: "90318099",
    });
    expect(contaAzul.enabledTargets.budgets).toBe(true);
    expect(contaAzul.enabledTargets.fiscalDocuments).toBe(true);
    expect(contaAzul.enabledTargets.payables).toBe(true);
    expect(contaAzul.enabledTargets.products).toBe(true);
    expect(contaAzul.enabledTargets.protocols).toBe(true);
    expect(contaAzul.enabledTargets.services).toBe(true);
    expect(contaAzul.enabledTargets.paymentStatusPolling).toBe(false);
  });

  it("keeps unsupported Conta Azul enum values on safe defaults", () => {
    const config = normalizeContaAzulConnectionConfig({
      budgetMode: "create_all",
      exportMode: "invoice",
      fiscalMode: "emit_all",
      protocolMode: "poll_all",
      saleTrigger: "automatic",
    });

    expect(config.budgetMode).toBe("sales_search_link");
    expect(config.exportMode).toBe("receivable_event");
    expect(config.fiscalMode).toBe("consultation_only");
    expect(config.protocolMode).toBe("api_lookup_verified");
    expect(config.saleTrigger).toBe("manual");
  });

  it("keeps fiscal issuance disabled until an official issuance endpoint is implemented", () => {
    const config = normalizeContaAzulConnectionConfig({
      fiscalMode: "issuance_supported",
      enabledTargets: {
        fiscalDocuments: true,
      },
    });

    expect(config.fiscalMode).toBe("consultation_only");
    expect(config.enabledTargets.fiscalDocuments).toBe(true);
  });

  it("keeps native budget writes disabled until an official orçamento endpoint is implemented", () => {
    const config = normalizeContaAzulConnectionConfig({
      budgetMode: "native_api_write_verified",
      enabledTargets: {
        budgets: true,
      },
    });

    expect(config.budgetMode).toBe("sales_search_link");
    expect(config.enabledTargets.budgets).toBe(true);
  });

  it("rejects non-official Conta Azul API base URLs", () => {
    expect(() =>
      normalizeContaAzulConnectionConfig({
        baseUrl: "https://erp.example.com",
      }),
    ).toThrow("Base URL da Conta Azul deve usar o endpoint oficial");
  });

  it("detects scheduled Conta Azul payment polling due windows", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");

    expect(
      isContaAzulPaymentPollingDue({
        config: normalizeContaAzulConnectionConfig(),
        now,
      }),
    ).toBe(true);

    expect(
      isContaAzulPaymentPollingDue({
        config: normalizeContaAzulConnectionConfig({
          polling: {
            receivablesLastRemoteUpdatedAt: "2026-05-24T11:45:00.000Z",
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: null,
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        now,
        intervalMs: 30 * 60 * 1000,
      }),
    ).toBe(false);

    expect(
      isContaAzulPaymentPollingDue({
        config: normalizeContaAzulConnectionConfig({
          polling: {
            receivablesLastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: null,
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        lastRemoteUpdatedAt: "2026-05-24T11:45:00.000Z",
        now,
        intervalMs: 30 * 60 * 1000,
      }),
    ).toBe(false);

    expect(
      isContaAzulPaymentPollingDue({
        config: normalizeContaAzulConnectionConfig({
          polling: {
            receivablesLastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: null,
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        lastSuccessfulPollAt: "2026-05-24T11:45:00.000Z",
        lastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
        now,
        intervalMs: 30 * 60 * 1000,
      }),
    ).toBe(false);

    expect(
      isContaAzulPaymentPollingDue({
        config: normalizeContaAzulConnectionConfig({
          polling: {
            receivablesLastRemoteUpdatedAt: "2026-05-24T11:45:00.000Z",
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: null,
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        pendingNextPage: 3,
        now,
        intervalMs: 30 * 60 * 1000,
      }),
    ).toBe(true);

    expect(
      isContaAzulPaymentPollingDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            paymentStatusPolling: false,
          },
        }),
        now,
      }),
    ).toBe(false);
  });

  it("detects scheduled Conta Azul fiscal polling due windows", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");

    expect(
      isContaAzulFiscalPollingDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            fiscalDocuments: true,
          },
        }),
        now,
      }),
    ).toBe(true);

    expect(
      isContaAzulFiscalPollingDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            fiscalDocuments: true,
          },
          polling: {
            receivablesLastRemoteUpdatedAt: null,
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: "2026-05-24T11:30:00.000Z",
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        now,
        intervalMs: 60 * 60 * 1000,
      }),
    ).toBe(false);

    expect(
      isContaAzulFiscalPollingDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            fiscalDocuments: true,
          },
          polling: {
            receivablesLastRemoteUpdatedAt: null,
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        lastSuccessfulPollAt: "2026-05-24T11:30:00.000Z",
        lastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
        now,
        intervalMs: 60 * 60 * 1000,
      }),
    ).toBe(false);

    expect(
      isContaAzulFiscalPollingDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            fiscalDocuments: true,
          },
          polling: {
            receivablesLastRemoteUpdatedAt: null,
            payablesLastRemoteUpdatedAt: null,
            invoicesLastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
            protocolsLastRemoteUpdatedAt: null,
            driftLastCheckedAt: null,
          },
        }),
        lastRemoteUpdatedAt: "2026-05-24T11:30:00.000Z",
        now,
        intervalMs: 60 * 60 * 1000,
      }),
    ).toBe(false);

    expect(
      isContaAzulFiscalPollingDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            fiscalDocuments: true,
          },
        }),
        pendingNextPage: 2,
        now,
        intervalMs: 60 * 60 * 1000,
      }),
    ).toBe(true);

    expect(
      isContaAzulFiscalPollingDue({
        config: normalizeContaAzulConnectionConfig(),
        now,
      }),
    ).toBe(false);
  });

  it("detects scheduled Conta Azul sync due windows by target", () => {
    const now = new Date("2026-05-24T12:00:00.000Z");
    const config = normalizeContaAzulConnectionConfig({
      schedules: {
        customer: {
          mode: "scheduled",
          frequency: "daily",
          nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
          lastScheduledRunAt: null,
        },
        service_order: {
          mode: "scheduled",
          frequency: "daily",
          nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
          lastScheduledRunAt: null,
        },
        billing_document: {
          mode: "scheduled",
          frequency: "daily",
          nextScheduledRunAt: "2026-05-24T12:30:00.000Z",
          lastScheduledRunAt: null,
        },
      },
    });

    expect(
      isContaAzulScheduledSyncDue({
        config,
        target: "customer",
        now,
      }),
    ).toBe(true);
    expect(
      isContaAzulScheduledSyncDue({
        config,
        target: "billing_document",
        now,
      }),
    ).toBe(false);
    expect(
      isContaAzulScheduledSyncDue({
        config,
        target: "service_order",
        now,
      }),
    ).toBe(false);

    expect(
      isContaAzulScheduledSyncDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            sales: true,
          },
          schedules: {
            service_order: {
              mode: "scheduled",
              frequency: "daily",
              nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
              lastScheduledRunAt: null,
            },
          },
        }),
        target: "service_order",
        now,
      }),
    ).toBe(true);

    expect(
      isContaAzulScheduledSyncDue({
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            budgets: true,
            sales: false,
          },
          schedules: {
            service_order: {
              mode: "scheduled",
              frequency: "daily",
              nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
              lastScheduledRunAt: null,
            },
          },
        }),
        target: "service_order",
        now,
      }),
    ).toBe(false);

    expect(
      isContaAzulScheduledSyncDue({
        config: normalizeContaAzulConnectionConfig({
          exportMode: "budget_to_sale",
          enabledTargets: {
            budgets: true,
            sales: false,
          },
          schedules: {
            service_order: {
              mode: "scheduled",
              frequency: "daily",
              nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
              lastScheduledRunAt: null,
            },
          },
        }),
        target: "service_order",
        now,
      }),
    ).toBe(true);
  });

  it("maps service order payloads to Conta Azul sale and budget payloads", () => {
    const serviceOrder = {
      externalId: "service_order:10",
      organizationId: "org-1",
      unitId: 2,
      unitName: "Laboratório massa",
      jobId: "1001",
      status: "APPROVED",
      customerExternalId: "customer:1",
      customerName: "Cliente Exemplo",
      serviceExternalId: "service:5",
      assetName: "Balança",
      assetTag: "BAL-1",
      serviceName: "Calibração",
      servicePriceCents: 15000,
      currency: "BRL",
      performedAt: null,
      approvedAt: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-23T10:00:00.000Z",
    };

    expect(mapServiceOrderToSalePayload(serviceOrder)).toMatchObject({
      externalId: "service_order:10",
      customerExternalId: "customer:1",
      saleNumber: "1001",
      saleDate: "2026-05-24",
      status: "APPROVED",
      totalCents: 15000,
      currency: "BRL",
      items: [
        {
          lineId: "service_order:10:service",
          catalogItemExternalId: "service:5",
          description: "Calibração",
          quantity: 1,
          unitPriceCents: 15000,
          totalCents: 15000,
        },
      ],
      paymentTerms: expect.objectContaining({
        dueDate: "2026-05-24",
        installments: [
          {
            dueDate: "2026-05-24",
            amountCents: 15000,
            description: "OS 1001",
          },
        ],
      }),
    });

    expect(mapServiceOrderToBudgetPayload(serviceOrder)).toMatchObject({
      externalId: "service_order:10",
      customerExternalId: "customer:1",
      budgetNumber: "1001",
      issueDate: "2026-05-24",
      totalCents: 15000,
      items: [
        expect.objectContaining({
          catalogItemExternalId: "service:5",
        }),
      ],
    });
  });

  it("blocks Conta Azul service order sync until sales or budget mode is enabled", () => {
    const warnings = buildDependencyWarnings({
      target: "service_order",
      provider: "conta_azul",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          sales: false,
          budgets: false,
        },
      }),
      integrationStatus: "ACTIVE",
      validated: true,
      coverageByTarget: emptyCoverage,
    });

    expect(warnings).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "service_order",
        severity: "error",
        message:
          "Habilite vendas ou orçamentos na Conta Azul antes de sincronizar ordens de serviço.",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "service_order",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            sales: true,
            services: true,
          },
        }),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([]);
  });

  it("gates Conta Azul catalog and contract sync as first-class targets", () => {
    expect(
      buildDependencyWarnings({
        target: "catalog_item",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig(),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "catalog_item",
        severity: "error",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "contract",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig({
          enabledTargets: {
            contracts: true,
          },
        }),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "contract",
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar contratos.",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "contract",
        provider: "generic_http",
        config: normalizeGenericFinancialErpConfig({
          baseUrl: "https://erp.example.com",
        }),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "contract",
        severity: "error",
      }),
    ]);
  });

  it("blocks Conta Azul supplier and transporter sync until their domains are enabled", () => {
    expect(
      buildDependencyWarnings({
        target: "supplier",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig(),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "supplier",
        severity: "error",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "transporter",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig(),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "transporter",
        severity: "error",
      }),
    ]);

    const enabledConfig = normalizeContaAzulConnectionConfig({
      enabledTargets: {
        suppliers: true,
        transporters: true,
      },
    });

    expect(
      buildDependencyWarnings({
        target: "supplier",
        provider: "conta_azul",
        config: enabledConfig,
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([]);
    expect(
      buildDependencyWarnings({
        target: "transporter",
        provider: "conta_azul",
        config: enabledConfig,
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([]);
  });

  it("blocks Conta Azul payables until supplier, account and payable domains are ready", () => {
    expect(
      buildDependencyWarnings({
        target: "payable",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig(),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "payable",
        severity: "error",
      }),
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "payable",
        severity: "error",
      }),
      expect.objectContaining({
        code: "REMOTE_CONFIG_MISSING",
        target: "payable",
        severity: "error",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "payable",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
          enabledTargets: {
            payables: true,
            suppliers: true,
          },
        }),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: {
          ...emptyCoverage,
          supplier: {
            target: "supplier",
            localCount: 2,
            linkedCount: 1,
            unlinkedCount: 1,
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "SUPPLIERS_NOT_SYNCED",
        target: "payable",
        severity: "error",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "payable",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
          enabledTargets: {
            payables: true,
            suppliers: true,
          },
        }),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([]);
  });

  it("warns when Conta Azul commercial exports are enabled without catalog domains", () => {
    const serviceOrderWarnings = buildDependencyWarnings({
      target: "service_order",
      provider: "conta_azul",
      config: normalizeContaAzulConnectionConfig({
        exportMode: "budget_to_sale",
        enabledTargets: {
          budgets: true,
          products: false,
          sales: false,
          services: false,
        },
      }),
      integrationStatus: "ACTIVE",
      validated: true,
      coverageByTarget: emptyCoverage,
    });

    expect(serviceOrderWarnings).toEqual([
      expect.objectContaining({
        code: "CATALOG_NOT_ENABLED",
        target: "service_order",
        severity: "warning",
      }),
    ]);

    const billingWarnings = buildDependencyWarnings({
      target: "billing_document",
      provider: "conta_azul",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
        exportMode: "sale_and_receivable",
        enabledTargets: {
          products: false,
          services: false,
        },
      }),
      integrationStatus: "ACTIVE",
      validated: true,
      coverageByTarget: emptyCoverage,
    });

    expect(billingWarnings).toEqual([
      expect.objectContaining({
        code: "CATALOG_NOT_ENABLED",
        target: "billing_document",
        severity: "warning",
      }),
    ]);

    expect(
      buildDependencyWarnings({
        target: "billing_document",
        provider: "conta_azul",
        config: normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
          exportMode: "sale_and_receivable",
          enabledTargets: {
            services: true,
          },
        }),
        integrationStatus: "ACTIVE",
        validated: true,
        coverageByTarget: emptyCoverage,
      }),
    ).toEqual([]);
  });

  it("does not block Conta Azul billing exports on deferred service order links", () => {
    const warnings = buildDependencyWarnings({
      target: "billing_document",
      provider: "conta_azul",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
      }),
      integrationStatus: "ACTIVE",
      validated: true,
      coverageByTarget: {
        ...emptyCoverage,
        customer: {
          target: "customer",
          localCount: 5,
          linkedCount: 5,
          unlinkedCount: 0,
        },
        service_order: {
          target: "service_order",
          localCount: 5,
          linkedCount: 0,
          unlinkedCount: 5,
        },
      },
    });

    expect(warnings).toEqual([]);
  });

  it("keeps generic billing exports dependent on service order links", () => {
    const warnings = buildDependencyWarnings({
      target: "billing_document",
      provider: "generic_http",
      config: normalizeGenericFinancialErpConfig({
        baseUrl: "https://erp.example.com",
      }),
      integrationStatus: "ACTIVE",
      validated: true,
      coverageByTarget: {
        ...emptyCoverage,
        customer: {
          target: "customer",
          localCount: 5,
          linkedCount: 5,
          unlinkedCount: 0,
        },
        service_order: {
          target: "service_order",
          localCount: 5,
          linkedCount: 0,
          unlinkedCount: 5,
        },
      },
    });

    expect(warnings).toEqual([
      expect.objectContaining({
        code: "SERVICE_ORDERS_NOT_SYNCED",
        severity: "error",
      }),
    ]);
  });
});
