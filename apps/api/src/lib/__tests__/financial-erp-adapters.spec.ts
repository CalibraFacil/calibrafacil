import { describe, expect, it } from "vitest";
import {
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
} from "@calibra-facil/shared";
import { createFinancialErpAdapter } from "../financial-erp-adapters";
import type {
  IntegrationBillingDocumentPayload,
  IntegrationBudgetPayload,
  IntegrationCatalogItemPayload,
  IntegrationContractPayload,
  IntegrationCustomerPayload,
  IntegrationObjectLinkTarget,
  IntegrationPayablePayload,
  IntegrationSalePayload,
  IntegrationSupplierPayload,
  IntegrationSyncCursor,
  IntegrationTransporterPayload,
} from "@calibra-facil/shared";

type LinkUpdate = {
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string | null;
  remoteDisplayId?: string | null;
  remoteEntityType?: string | null;
  metadata?: Record<string, unknown> | null;
};

const saleItems = [
  {
    lineId: "line:1",
    catalogItemExternalId: "service:1",
    description: "Calibração",
    quantity: 1,
    unitPriceCents: 15000,
    totalCents: 15000,
  },
];

const salePaymentTerms = {
  paymentMethodId: "BOLETO_BANCARIO",
  financialAccountId: "account-1",
  paymentConditionLabel: "À vista",
  dueDate: "2026-06-24",
  installments: [],
};

describe("financial ERP adapters", () => {
  it("validates generic HTTP connections through the adapter boundary", async () => {
    const config = normalizeGenericFinancialErpConfig({
      baseUrl: "https://erp.example.com/api",
      healthPath: "/status",
    });
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
      });
      return Response.json({ ok: true });
    };

    const adapter = createFinancialErpAdapter({
      provider: "generic_http",
      integrationId: "int-1",
      organizationId: "org-1",
      config,
      secret: "token",
      fetchImpl,
    });

    await expect(adapter.validateConnection()).resolves.toMatchObject({
      ok: true,
      provider: "generic_http",
      status: "connected",
    });
    expect(requests).toEqual([
      {
        url: "https://erp.example.com/api/status",
        method: "GET",
      },
    ]);
  });

  it("loads Conta Azul reference data through the native adapter boundary", async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
      });
      if (String(input).includes("/saldo-atual")) {
        return Response.json({ saldo_atual: 1234.56 });
      }
      if (String(input).includes("/financeiro/transferencias")) {
        return Response.json({
          itens: [
            {
              id: "transfer-1",
              descricao: "Transferência para conta reserva",
              valor: 250,
              data: "2026-05-24",
            },
          ],
        });
      }
      if (String(input).includes("/v1/produtos/ecommerce-categorias")) {
        return Response.json({
          itens: [
            {
              id: "ecommerce-category-1",
              descricao: "Instrumentos",
              codigo: "INST",
              status: "ATIVO",
            },
          ],
        });
      }
      if (String(input).includes("/v1/produtos/ecommerce-marcas")) {
        return Response.json({
          itens: [
            {
              id: "ecommerce-brand-1",
              descricao: "CalibraFácil",
              codigo: "CF",
              status: "ATIVO",
            },
          ],
        });
      }
      if (String(input).includes("/v1/produtos/cest")) {
        return Response.json({
          itens: [
            {
              id: 1001,
              descricao: "Instrumentos de medição",
              codigo: "01.001.00",
              status: "ATIVO",
            },
          ],
        });
      }
      if (String(input).includes("/v1/produtos/ncm")) {
        return Response.json({
          itens: [
            {
              id: 90318099,
              descricao: "Instrumentos e aparelhos de medida",
              codigo: "90318099",
              status: "ATIVO",
            },
          ],
        });
      }
      if (String(input).includes("/v1/produtos/unidades-medida")) {
        return Response.json({
          itens: [
            {
              id: 1,
              descricao: "Unidade",
              codigo: "UN",
              status: "ATIVO",
            },
          ],
        });
      }
      if (String(input).includes("/v1/produtos")) {
        return Response.json({
          itens: [
            {
              id: "product-1",
              nome: "Peso padrão",
              codigo_sku: "PESO-001",
              status: "ATIVO",
            },
          ],
        });
      }
      if (String(input).includes("/v1/servicos")) {
        return Response.json({
          itens: [
            {
              id: "service-1",
              descricao: "Calibração RBC",
              codigo: "CAL-001",
              id_externo: "service:1",
              status: "ATIVO",
              tipo_servico: "PRESTADO",
            },
          ],
        });
      }

      return Response.json({
        itens: [
          {
            id: "account-1",
            nome: "Conta corrente",
            ativo: true,
            tipo: "CONTA_CORRENTE",
            codigo_banco: 341,
          },
        ],
      });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
    });

    if (!adapter.listReferenceData) {
      throw new Error("expected Conta Azul reference data support");
    }

    await expect(adapter.listReferenceData("accounts")).resolves.toEqual({
      domain: "accounts",
      items: [
        {
          id: "account-1",
          name: "Conta corrente",
          code: null,
          active: true,
          metadata: {
            amount: null,
            bankCode: 341,
            date: null,
            legacyId: null,
            status: null,
            type: "CONTA_CORRENTE",
          },
        },
      ],
      nextCursor: null,
    });
    await expect(adapter.listReferenceData("balances")).resolves.toEqual({
      domain: "balances",
      items: [
        {
          id: "account-1",
          name: "Conta corrente",
          code: null,
          active: true,
          metadata: expect.objectContaining({
            amount: 1234.56,
            financialAccountId: "account-1",
            financialAccountName: "Conta corrente",
            sourceIndex: 0,
            type: "CONTA_CORRENTE",
          }),
        },
      ],
      nextCursor: null,
    });
    await expect(adapter.listReferenceData("transfers")).resolves.toEqual({
      domain: "transfers",
      items: [
        {
          id: "transfer-1",
          name: "Transferência para conta reserva",
          code: null,
          active: null,
          metadata: {
            amount: 250,
            bankCode: null,
            date: "2026-05-24",
            legacyId: null,
            status: null,
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(adapter.listReferenceData("products")).resolves.toEqual({
      domain: "products",
      items: [
        {
          id: "product-1",
          name: "Peso padrão",
          code: "PESO-001",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            legacyId: null,
            status: "ATIVO",
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(
      adapter.listReferenceData("productEcommerceCategories"),
    ).resolves.toEqual({
      domain: "productEcommerceCategories",
      items: [
        {
          id: "ecommerce-category-1",
          name: "Instrumentos",
          code: "INST",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            legacyId: null,
            status: "ATIVO",
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(
      adapter.listReferenceData("productEcommerceBrands"),
    ).resolves.toEqual({
      domain: "productEcommerceBrands",
      items: [
        {
          id: "ecommerce-brand-1",
          name: "CalibraFácil",
          code: "CF",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            legacyId: null,
            status: "ATIVO",
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(adapter.listReferenceData("cest")).resolves.toEqual({
      domain: "cest",
      items: [
        {
          id: "1001",
          name: "Instrumentos de medição",
          code: "01.001.00",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            legacyId: null,
            status: "ATIVO",
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(adapter.listReferenceData("ncm")).resolves.toEqual({
      domain: "ncm",
      items: [
        {
          id: "90318099",
          name: "Instrumentos e aparelhos de medida",
          code: "90318099",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            legacyId: null,
            status: "ATIVO",
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(adapter.listReferenceData("units")).resolves.toEqual({
      domain: "units",
      items: [
        {
          id: "1",
          name: "Unidade",
          code: "UN",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            legacyId: null,
            status: "ATIVO",
            type: null,
          },
        },
      ],
      nextCursor: null,
    });
    await expect(
      adapter.listReferenceData("serviceCategories"),
    ).resolves.toEqual({
      domain: "serviceCategories",
      items: [
        {
          id: "service-1",
          name: "Calibração RBC",
          code: "CAL-001",
          active: true,
          metadata: {
            amount: null,
            bankCode: null,
            date: null,
            externalId: "service:1",
            legacyId: null,
            status: "ATIVO",
            type: "PRESTADO",
          },
        },
      ],
      nextCursor: null,
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api-v2.contaazul.com/v1/conta-financeira?pagina=1&tamanho_pagina=100&apenas_ativo=true",
      "https://api-v2.contaazul.com/v1/conta-financeira?pagina=1&tamanho_pagina=100&apenas_ativo=true",
      "https://api-v2.contaazul.com/v1/conta-financeira/account-1/saldo-atual",
      // transfers requires a date range; the window is relative to today.
      expect.stringMatching(
        /^https:\/\/api-v2\.contaazul\.com\/v1\/financeiro\/transferencias\?pagina=1&tamanho_pagina=100&data_inicio=\d{4}-\d{2}-\d{2}&data_fim=\d{4}-\d{2}-\d{2}$/,
      ),
      "https://api-v2.contaazul.com/v1/produtos?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/produtos/ecommerce-categorias?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/produtos/ecommerce-marcas?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/produtos/cest?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/produtos/ncm?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/produtos/unidades-medida?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/servicos?pagina=1&tamanho_pagina=100",
    ]);
  });

  it("degrades a Conta Azul 4xx reference catalog to an empty list", async () => {
    // Some reference endpoints (e.g. product-ecommerce-categories) reject the
    // standard pagination filters with a 400. That must not fail the settings
    // page — the catalog should come back empty.
    const fetchImpl: typeof fetch = async () =>
      Response.json(
        {
          error:
            "Os filtros informados para busca de categoria de e-commerce são inválidos",
        },
        { status: 400 },
      );
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
    });

    if (!adapter.listReferenceData) {
      throw new Error("expected Conta Azul reference data support");
    }

    await expect(
      adapter.listReferenceData("productEcommerceCategories"),
    ).resolves.toEqual({
      domain: "productEcommerceCategories",
      items: [],
      nextCursor: null,
    });
  });

  it("upserts generic HTTP customers with existing remote link support", async () => {
    const config = normalizeGenericFinancialErpConfig({
      baseUrl: "https://erp.example.com",
      customerPath: "/people",
    });
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      if (init?.method === "GET") {
        return Response.json({ items: [], totalItems: 0 });
      }
      return Response.json({ id: "remote-customer-1" });
    };
    const payload: IntegrationCustomerPayload = {
      externalId: "customer:1",
      organizationId: "org-1",
      name: "Cliente Exemplo",
      taxId: "11222333000181",
      email: "financeiro@example.com",
      phone: null,
      address: null,
      createdAt: null,
      updatedAt: null,
    };

    const adapter = createFinancialErpAdapter({
      provider: "generic_http",
      integrationId: "int-1",
      organizationId: "org-1",
      config,
      secret: "token",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return "remote-customer-1";
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    await expect(adapter.upsertCustomer(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-customer-1",
      remoteEntityType: "customer",
    });
    expect(requests).toEqual([
      {
        url: "https://erp.example.com/people/remote-customer-1",
        method: "PUT",
        body: expect.objectContaining({
          externalId: "customer:1",
          name: "Cliente Exemplo",
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "customer",
        localEntityId: "customer:1",
        remoteEntityId: "remote-customer-1",
        remoteDisplayId: "remote-customer-1",
        remoteEntityType: "customer",
      },
    ]);
  });

  it("exports generic HTTP billing documents through the billing path", async () => {
    const config = normalizeGenericFinancialErpConfig({
      baseUrl: "https://erp.example.com",
      billingDocumentPath: "/billing",
    });
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
      });
      return Response.json({ remoteId: "remote-billing-1" });
    };
    const payload: IntegrationBillingDocumentPayload = {
      externalId: "billing_document:1",
      documentNumber: "FIN-1",
      organizationId: "org-1",
      unitId: null,
      unitName: null,
      customerExternalId: "customer:1",
      customerName: "Cliente Exemplo",
      totalCents: 15000,
      currency: "BRL",
      issueDate: "2026-05-24",
      dueDate: "2026-06-24",
      status: "issued",
      items: [],
    };

    const adapter = createFinancialErpAdapter({
      provider: "generic_http",
      integrationId: "int-1",
      organizationId: "org-1",
      config,
      secret: "token",
      fetchImpl,
    });

    await expect(adapter.exportBillingDocument(payload)).resolves.toMatchObject(
      {
        remoteEntityId: "remote-billing-1",
        remoteEntityType: "billing_document",
      },
    );
    expect(requests).toEqual([
      {
        url: "https://erp.example.com/billing",
        method: "POST",
      },
    ]);
  });

  it("validates Conta Azul connections through the native client", async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
      });
      return Response.json({ itens: [] });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
    });

    await expect(adapter.validateConnection()).resolves.toMatchObject({
      ok: true,
      provider: "conta_azul",
      status: "connected",
    });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/conta-financeira?pagina=1&tamanho_pagina=10&apenas_ativo=true",
        method: "GET",
      },
    ]);
  });

  it("upserts Conta Azul customers with Pessoa create and patch paths", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      // Real Conta Azul PATCH /v1/pessoas/{id} returns 204 No Content.
      // Only POST /v1/pessoas (create) returns a JSON body with `id`.
      if (init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      return Response.json({ id: "remote-customer-1" });
    };
    const payload: IntegrationCustomerPayload = {
      externalId: "customer:1",
      organizationId: "org-1",
      name: "Cliente Exemplo",
      taxId: "11222333000181",
      email: "financeiro@example.com",
      phone: null,
      address: null,
      createdAt: null,
      updatedAt: null,
    };
    let existingRemoteId: string | null = null;
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return existingRemoteId;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
          existingRemoteId = params.remoteEntityId;
        },
      },
    });

    await expect(adapter.upsertCustomer(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-customer-1",
      remoteEntityType: "conta_azul_pessoa",
    });
    await expect(adapter.upsertCustomer(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-customer-1",
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=10&documentos=11222333000181&tipo_perfil=Cliente",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/pessoas",
        method: "POST",
        body: expect.objectContaining({
          nome: "Cliente Exemplo",
          cnpj: "11222333000181",
          perfis: [{ tipo_perfil: "Cliente" }],
        }),
      },
      {
        url: "https://api-v2.contaazul.com/v1/pessoas/remote-customer-1",
        method: "PATCH",
        body: expect.objectContaining({
          nome: "Cliente Exemplo",
          cnpj: "11222333000181",
        }),
      },
    ]);
    expect(linkUpdates).toHaveLength(2);
    expect(linkUpdates[0]).toMatchObject({
      remoteEntityType: "conta_azul_pessoa",
      metadata: {
        provider: "conta_azul",
        perfil: "Cliente",
        pessoaRole: "customer",
        matchedBy: "created",
        resource: "pessoas",
      },
    });
  });

  it("links and patches an existing Conta Azul customer found by document", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      if (init?.method === "GET") {
        return Response.json({
          items: [
            {
              id: "remote-customer-1",
              documento: "11.222.333/0001-81",
              nome: "Cliente Exemplo",
            },
          ],
          totalItems: 1,
        });
      }
      if (init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      return Response.json({ id: "remote-customer-1" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    await expect(
      adapter.upsertCustomer({
        externalId: "customer:1",
        organizationId: "org-1",
        name: "Cliente Exemplo",
        taxId: "11222333000181",
        email: "financeiro@example.com",
        phone: null,
        address: null,
        createdAt: null,
        updatedAt: null,
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "remote-customer-1",
      remoteEntityType: "conta_azul_pessoa",
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=10&documentos=11222333000181&tipo_perfil=Cliente",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/pessoas/remote-customer-1",
        method: "PATCH",
        body: expect.objectContaining({
          nome: "Cliente Exemplo",
          cnpj: "11222333000181",
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "customer",
        localEntityId: "customer:1",
        remoteEntityId: "remote-customer-1",
        remoteDisplayId: "remote-customer-1",
        remoteEntityType: "conta_azul_pessoa",
        metadata: {
          provider: "conta_azul",
          resource: "pessoas",
          pessoaRole: "customer",
          perfil: "Cliente",
          matchedBy: "document",
        },
      },
    ]);
  });

  it("upserts Conta Azul suppliers through the Pessoas API with supplier links", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({ id: "remote-supplier-1" });
    };
    const payload: IntegrationSupplierPayload = {
      externalId: "supplier:1",
      organizationId: "org-1",
      pessoaRole: "supplier",
      name: "Laboratório terceiro",
      taxId: "11.222.333/0001-81",
      email: "terceiro@example.com",
      phone: null,
      address: null,
      createdAt: null,
      updatedAt: null,
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.upsertSupplier) {
      throw new Error("expected Conta Azul supplier support");
    }

    await expect(adapter.upsertSupplier(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-supplier-1",
      remoteEntityType: "conta_azul_pessoa",
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=10&documentos=11222333000181&tipo_perfil=Fornecedor",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/pessoas",
        method: "POST",
        body: expect.objectContaining({
          nome: "Laboratório terceiro",
          cnpj: "11222333000181",
          perfis: [{ tipo_perfil: "Fornecedor" }],
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "supplier",
        localEntityId: "supplier:1",
        remoteEntityId: "remote-supplier-1",
        remoteDisplayId: "remote-supplier-1",
        remoteEntityType: "conta_azul_pessoa",
        metadata: {
          provider: "conta_azul",
          resource: "pessoas",
          pessoaRole: "supplier",
          perfil: "Fornecedor",
          matchedBy: "created",
        },
      },
    ]);
  });

  it("upserts Conta Azul transporters through the Pessoas API with transporter links", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({ id: "remote-transporter-1" });
    };
    const payload: IntegrationTransporterPayload = {
      externalId: "transporter:1",
      organizationId: "org-1",
      pessoaRole: "transporter",
      name: "Transportadora Exemplo",
      taxId: "11.222.333/0001-81",
      email: "logistica@example.com",
      phone: null,
      address: null,
      createdAt: null,
      updatedAt: null,
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.upsertTransporter) {
      throw new Error("expected Conta Azul transporter support");
    }

    await expect(adapter.upsertTransporter(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-transporter-1",
      remoteEntityType: "conta_azul_pessoa",
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/pessoas?pagina=1&tamanho_pagina=10&documentos=11222333000181&tipo_perfil=Transportadora",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/pessoas",
        method: "POST",
        body: expect.objectContaining({
          nome: "Transportadora Exemplo",
          cnpj: "11222333000181",
          perfis: [{ tipo_perfil: "Transportadora" }],
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "transporter",
        localEntityId: "transporter:1",
        remoteEntityId: "remote-transporter-1",
        remoteDisplayId: "remote-transporter-1",
        remoteEntityType: "conta_azul_pessoa",
        metadata: {
          provider: "conta_azul",
          resource: "pessoas",
          pessoaRole: "transporter",
          perfil: "Transportadora",
          matchedBy: "created",
        },
      },
    ]);
  });

  it("upserts Conta Azul product catalog items with SKU dedupe", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (init?.method === "GET") {
        return Response.json({
          items: [
            {
              id: "remote-product-1",
              codigo_sku: "PESO-001",
              nome: "Peso padrão",
            },
          ],
          totalItems: 1,
        });
      }
      if (init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      return Response.json({ id: "remote-product-1" });
    };
    const payload: IntegrationCatalogItemPayload = {
      externalId: "product:1",
      organizationId: "org-1",
      kind: "product",
      code: "PESO-001",
      name: "Peso padrão",
      description: "Peso classe F1",
      priceCents: 15000,
      currency: "BRL",
      unitOfMeasureId: "unit-1",
      categoryId: "category-1",
      fiscalMetadata: {
        ncmId: "ncm-1",
      },
      active: true,
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultCostCenterId: "cost-center-1",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.upsertCatalogItem) {
      throw new Error("expected Conta Azul catalog support");
    }

    await expect(adapter.upsertCatalogItem(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-product-1",
      remoteEntityType: "conta_azul_product",
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/produtos?pagina=1&tamanho_pagina=10&sku=PESO-001&status=ATIVO",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/produtos/remote-product-1",
        method: "PATCH",
        body: expect.objectContaining({
          categoria: { id: "category-1" },
          codigo_sku: "PESO-001",
          estoque: {
            valor_venda: 150,
          },
          fiscal: {
            ncm: { id: "ncm-1" },
            unidade_medida: { id: "unit-1" },
          },
          id_centro_custo: "cost-center-1",
          nome: "Peso padrão",
          status: "ATIVO",
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "catalog_item",
        localEntityId: "product:1",
        remoteEntityId: "remote-product-1",
        remoteDisplayId: "remote-product-1",
        remoteEntityType: "conta_azul_product",
        metadata: {
          provider: "conta_azul",
          resource: "produtos",
          catalogKind: "product",
          sku: "PESO-001",
          matchedBy: "sku",
        },
      },
    ]);
  });

  it("upserts Conta Azul services through /v1/servicos with codigo dedupe", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (init?.method === "GET") {
        return Response.json({
          items: [
            { id: "remote-service-1", codigo: "CAL-001", descricao: "Calibração" },
          ],
          totalItems: 1,
        });
      }
      if (init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      return Response.json({ id: "remote-service-1" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.upsertCatalogItem) {
      throw new Error("expected Conta Azul catalog support");
    }

    const result = await adapter.upsertCatalogItem({
      externalId: "service:1",
      organizationId: "org-1",
      kind: "service",
      code: "CAL-001",
      name: "Calibração",
      description: null,
      priceCents: 10_000,
      currency: "BRL",
      unitOfMeasureId: null,
      categoryId: null,
      fiscalMetadata: null,
      active: true,
    });

    expect(result).toMatchObject({
      remoteEntityId: "remote-service-1",
      remoteEntityType: "conta_azul_servico",
    });

    // Search (GET) then PATCH because the codigo lookup matched.
    expect(requests.map((r) => r.method)).toEqual(["GET", "PATCH"]);
    expect(requests[0]?.url).toContain(
      "/v1/servicos?pagina=1&tamanho_pagina=10&codigo=CAL-001",
    );
    expect(requests[1]?.url).toBe(
      "https://api-v2.contaazul.com/v1/servicos/remote-service-1",
    );
    expect(requests[1]?.body).toMatchObject({
      codigo: "CAL-001",
      descricao: "Calibração",
      preco: 100,
      status: "ATIVO",
      tipo_servico: "PRESTADO",
    });
    expect(linkUpdates).toEqual([
      {
        target: "catalog_item",
        localEntityId: "service:1",
        remoteEntityId: "remote-service-1",
        remoteDisplayId: "remote-service-1",
        remoteEntityType: "conta_azul_servico",
        metadata: {
          provider: "conta_azul",
          resource: "servicos",
          catalogKind: "service",
          codigo: "CAL-001",
          matchedBy: "codigo",
        },
      },
    ]);
  });

  it("exports Conta Azul billing documents as receivable events after customer sync", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({
        // Live API returns the protocol id as `protocolo` (Portuguese).
        protocolo: "protocol-1",
        status: "SUCCESS",
        createdAt: "2026-05-24T00:00:00Z",
      });
    };
    const payload: IntegrationBillingDocumentPayload = {
      externalId: "billing_document:1",
      documentNumber: "FIN-1",
      organizationId: "org-1",
      unitId: null,
      unitName: null,
      customerExternalId: "customer:1",
      customerName: "Cliente Exemplo",
      totalCents: 15000,
      currency: "BRL",
      issueDate: "2026-05-24",
      dueDate: "2026-06-24",
      status: "issued",
      items: [],
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
        defaultCategoryId: "category-1",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    await expect(adapter.exportBillingDocument(payload)).resolves.toMatchObject(
      {
        remoteEntityId: "protocol-1",
        remoteEntityType: "conta_azul_receivable_protocol",
      },
    );
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber",
        method: "POST",
        body: expect.objectContaining({
          contato: "remote-customer-1",
          conta_financeira: "account-1",
          valor: 150,
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "billing_document",
        localEntityId: "billing_document:1",
        remoteEntityId: "protocol-1",
        remoteDisplayId: "protocol-1",
        remoteEntityType: "conta_azul_receivable_protocol",
        metadata: {
          provider: "conta_azul",
          resource: "financeiro/eventos-financeiros/contas-a-receber",
          exportMode: "receivable_event",
        },
      },
    ]);
  });

  it("exports Conta Azul billing documents as sales when sale mode is configured", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (String(input).endsWith("/v1/venda/proximo-numero")) {
        return Response.json(4512645);
      }
      return Response.json({ id: "remote-sale-1" });
    };
    const payload: IntegrationBillingDocumentPayload = {
      externalId: "billing_document:1",
      documentNumber: "FIN-1",
      organizationId: "org-1",
      unitId: 10,
      unitName: "Central",
      customerExternalId: "customer:1",
      customerName: "Cliente Exemplo",
      totalCents: 15000,
      currency: "BRL",
      issueDate: "2026-05-24",
      dueDate: "2026-06-24",
      status: "issued",
      items: [
        {
          lineId: "billing_document_item:1",
          jobId: "OS-1",
          catalogItemExternalId: "service:1",
          description: "Calibração",
          quantity: 1,
          unitPriceCents: 15000,
          totalCents: 15000,
        },
      ],
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        exportMode: "sale",
        defaultFinancialAccountId: "account-1",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    await expect(adapter.exportBillingDocument(payload)).resolves.toMatchObject(
      {
        remoteEntityId: "remote-sale-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_sale",
      },
    );
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/venda/proximo-numero",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda",
        method: "POST",
        body: expect.objectContaining({
          id_cliente: "remote-customer-1",
          numero: 4512645,
          situacao: "APROVADO",
          data_venda: "2026-05-24",
          itens: [
            expect.objectContaining({
              id: "remote-service-1",
              quantidade: 1,
              valor: 150,
            }),
          ],
          condicao_pagamento: expect.objectContaining({
            id_conta_financeira: "account-1",
            parcelas: [
              expect.objectContaining({
                data_vencimento: "2026-06-24",
                valor: 150,
              }),
            ],
          }),
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "sale",
        localEntityId: "billing_document:1",
        remoteEntityId: "remote-sale-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_sale",
        metadata: expect.objectContaining({
          exportMode: "sale",
          resource: "venda",
        }),
      }),
      expect.objectContaining({
        target: "billing_document",
        localEntityId: "billing_document:1",
        remoteEntityId: "remote-sale-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_sale",
        metadata: expect.objectContaining({
          exportMode: "sale",
          resource: "venda",
          receivableStrategy: "sale_only",
        }),
      }),
    ]);
  });

  it("registers Conta Azul receivable protocol status when protocols are enabled", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(input).endsWith("/v1/protocolo/protocol-1")) {
        return Response.json({
          id: "protocol-1",
          resposta: "Operação realizada com sucesso.",
          status: "SUCCESS",
          evento_financeiro_id: "receivable-event-1",
        });
      }
      return Response.json({
        protocolId: "protocol-1",
        status: "PENDING",
        createdAt: "2026-05-24T00:00:00Z",
      });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
        defaultCategoryId: "category-1",
        protocolMode: "api_lookup_verified",
        enabledTargets: {
          protocols: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    await expect(
      adapter.exportBillingDocument({
        externalId: "billing_document:1",
        documentNumber: "FIN-1",
        organizationId: "org-1",
        unitId: null,
        unitName: null,
        customerExternalId: "customer:1",
        customerName: "Cliente Exemplo",
        totalCents: 15000,
        currency: "BRL",
        issueDate: "2026-05-24",
        dueDate: "2026-06-24",
        status: "issued",
        items: [],
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "protocol-1",
      remoteEntityType: "conta_azul_receivable_protocol",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber",
      "https://api-v2.contaazul.com/v1/protocolo/protocol-1",
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "billing_document",
        localEntityId: "billing_document:1",
        remoteEntityId: "protocol-1",
      }),
      expect.objectContaining({
        target: "protocol",
        localEntityId: "billing_document:1:protocol",
        remoteEntityId: "protocol-1",
        remoteDisplayId: "protocol-1",
        remoteEntityType: "conta_azul_protocol",
        metadata: expect.objectContaining({
          provider: "conta_azul",
          resource: "protocolo",
          source: "receivable_export",
          originTarget: "billing_document",
          originLocalEntityId: "billing_document:1",
          status: "SUCCESS",
          responseMessage: "Operação realizada com sucesso.",
          eventId: "receivable-event-1",
        }),
      }),
    ]);
  });

  it("keeps Conta Azul protocol links metadata-only when configured", async () => {
    const requests: string[] = [];
    const linkUpdates: LinkUpdate[] = [];
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
        defaultCategoryId: "category-1",
        protocolMode: "metadata_only",
        enabledTargets: {
          protocols: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl: async (input) => {
        requests.push(String(input));
        return Response.json({
          protocolId: "protocol-1",
          status: "PENDING",
        });
      },
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    await adapter.exportBillingDocument({
      externalId: "billing_document:1",
      documentNumber: "FIN-1",
      organizationId: "org-1",
      unitId: null,
      unitName: null,
      customerExternalId: "customer:1",
      customerName: "Cliente Exemplo",
      totalCents: 15000,
      currency: "BRL",
      issueDate: "2026-05-24",
      dueDate: "2026-06-24",
      status: "issued",
      items: [],
    });

    expect(requests).toEqual([
      "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-receber",
    ]);
    expect(linkUpdates).toContainEqual(
      expect.objectContaining({
        target: "protocol",
        localEntityId: "billing_document:1:protocol",
        remoteEntityId: "protocol-1",
        metadata: expect.objectContaining({
          lookupStatus: "metadata_only",
          source: "receivable_export",
        }),
      }),
    );
  });

  it("polls Conta Azul protocol links and refreshes protocol metadata", async () => {
    const requests: string[] = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json({
        id: "protocol-1",
        resposta: "Processado",
        status: "SUCCESS",
        evento_financeiro_id: "receivable-event-1",
      });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        protocolMode: "api_lookup_verified",
        enabledTargets: {
          protocols: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async listLinks(params) {
          expect(params).toEqual({
            targets: ["protocol"],
            limit: 50,
            offset: 0,
          });
          return [
            {
              target: "protocol",
              localEntityId: "billing_document:1:protocol",
              remoteEntityId: "protocol-1",
              remoteEntityType: "conta_azul_protocol",
              metadata: {
                source: "receivable_export",
                originTarget: "billing_document",
              },
            },
          ];
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.pollProtocols) {
      throw new Error("expected Conta Azul protocol polling support");
    }

    await expect(
      adapter.pollProtocols({
        cursorType: "conta_azul_protocols",
        lastRemoteUpdatedAt: null,
        lastSuccessfulPollAt: null,
        nextPage: null,
        state: { requestedLimit: 50 },
      }),
    ).resolves.toMatchObject({
      processedCount: 1,
      updatedCount: 1,
      warnings: [],
      cursor: {
        cursorType: "conta_azul_protocols",
        nextPage: null,
      },
    });
    expect(requests).toEqual([
      "https://api-v2.contaazul.com/v1/protocolo/protocol-1",
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "protocol",
        localEntityId: "billing_document:1:protocol",
        remoteEntityId: "protocol-1",
        remoteDisplayId: "protocol-1",
        remoteEntityType: "conta_azul_protocol",
        metadata: expect.objectContaining({
          provider: "conta_azul",
          resource: "protocolo",
          source: "protocol_poll",
          originTarget: "billing_document",
          status: "SUCCESS",
          responseMessage: "Processado",
          eventId: "receivable-event-1",
        }),
      }),
    ]);
  });

  it("checks Conta Azul reference links through official list endpoints during drift polling", async () => {
    const linkUpdates: LinkUpdate[] = [];
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);

      if (url.includes("/v1/conta-financeira/account-1/saldo-atual")) {
        return Response.json({ saldo_atual: 1234.56 });
      }
      if (url.includes("/v1/conta-financeira")) {
        return Response.json({
          itens: [{ id: "account-1", nome: "Conta corrente", ativo: true }],
        });
      }
      if (url.includes("/v1/categorias")) {
        return Response.json({
          itens: [{ id: "category-1", nome: "Receitas", ativo: true }],
        });
      }
      if (url.includes("/v1/centro-de-custo")) {
        return Response.json({
          itens: [{ id: "cost-center-1", nome: "Laboratório", ativo: true }],
        });
      }
      if (url.includes("/v1/financeiro/categorias-dre")) {
        return Response.json({
          itens: [{ id: "dre-1", nome: "Receita operacional" }],
        });
      }
      if (url.includes("/v1/produtos/ncm")) {
        return Response.json({
          itens: [
            {
              id: 90318099,
              descricao: "Instrumentos e aparelhos de medida",
              codigo: "90318099",
              status: "ATIVO",
            },
          ],
        });
      }
      if (url.includes("/v1/venda/vendedores")) {
        return Response.json([{ id: "seller-1", nome: "Ana Comercial" }]);
      }
      if (url.includes("/v1/financeiro/transferencias")) {
        return Response.json({
          itens: [{ id: "transfer-1", descricao: "Reserva", valor: 250 }],
        });
      }

      return Response.json({ itens: [] });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          driftChecks: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async listLinks(params) {
          expect(params.targets).toEqual(
            expect.arrayContaining([
              "catalog_item",
              "category",
              "cost_center",
              "dre_category",
              "financial_account",
              "financial_transfer",
              "seller",
            ]),
          );
          return [
            {
              target: "financial_account",
              localEntityId: "conta_azul:accounts:account-1",
              remoteEntityId: "account-1",
              remoteEntityType: "conta_azul_financial_account",
              metadata: { provider: "conta_azul", domain: "accounts" },
            },
            {
              target: "financial_account",
              localEntityId: "conta_azul:balances:account-1",
              remoteEntityId: "account-1",
              remoteEntityType: "conta_azul_financial_account_balance",
              metadata: { provider: "conta_azul", domain: "balances" },
            },
            {
              target: "category",
              localEntityId: "conta_azul:categories:category-1",
              remoteEntityId: "category-1",
              remoteEntityType: "conta_azul_financial_category",
              metadata: { provider: "conta_azul", domain: "categories" },
            },
            {
              target: "cost_center",
              localEntityId: "conta_azul:costCenters:cost-center-1",
              remoteEntityId: "cost-center-1",
              remoteEntityType: "conta_azul_cost_center",
              metadata: { provider: "conta_azul", domain: "costCenters" },
            },
            {
              target: "dre_category",
              localEntityId: "conta_azul:dreCategories:dre-1",
              remoteEntityId: "dre-1",
              remoteEntityType: "conta_azul_dre_category",
              metadata: { provider: "conta_azul", domain: "dreCategories" },
            },
            {
              target: "catalog_item",
              localEntityId: "conta_azul:ncm:90318099",
              remoteEntityId: "90318099",
              remoteEntityType: "conta_azul_product_ncm",
              metadata: { provider: "conta_azul", domain: "ncm" },
            },
            {
              target: "seller",
              localEntityId: "conta_azul:sellers:seller-1",
              remoteEntityId: "seller-1",
              remoteEntityType: "conta_azul_seller",
              metadata: { provider: "conta_azul", domain: "sellers" },
            },
            {
              target: "financial_transfer",
              localEntityId: "conta_azul:transfers:transfer-1",
              remoteEntityId: "transfer-1",
              remoteEntityType: "conta_azul_financial_transfer",
              metadata: { provider: "conta_azul", domain: "transfers" },
            },
          ];
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.pollRemoteDrift) {
      throw new Error("expected Conta Azul drift polling support");
    }

    await expect(
      adapter.pollRemoteDrift({
        cursorType: "conta_azul_remote_drift",
        lastRemoteUpdatedAt: null,
        lastSuccessfulPollAt: null,
        nextPage: null,
        state: { requestedLimit: 50 },
      }),
    ).resolves.toMatchObject({
      processedCount: 8,
      updatedCount: 8,
      warnings: [],
    });
    expect(requests).toEqual([
      "https://api-v2.contaazul.com/v1/conta-financeira?pagina=1&tamanho_pagina=100&apenas_ativo=true",
      "https://api-v2.contaazul.com/v1/conta-financeira?pagina=1&tamanho_pagina=100&apenas_ativo=true",
      "https://api-v2.contaazul.com/v1/conta-financeira/account-1/saldo-atual",
      "https://api-v2.contaazul.com/v1/categorias?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/centro-de-custo?pagina=1&tamanho_pagina=100&filtro_rapido=ATIVO",
      "https://api-v2.contaazul.com/v1/financeiro/categorias-dre",
      "https://api-v2.contaazul.com/v1/produtos/ncm?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/venda/vendedores",
      // transfers requires a date range; the window is relative to today.
      expect.stringMatching(
        /^https:\/\/api-v2\.contaazul\.com\/v1\/financeiro\/transferencias\?pagina=1&tamanho_pagina=100&data_inicio=\d{4}-\d{2}-\d{2}&data_fim=\d{4}-\d{2}-\d{2}$/,
      ),
    ]);
    expect(linkUpdates).toHaveLength(8);
    expect(linkUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "financial_account" }),
        expect.objectContaining({ target: "category" }),
        expect.objectContaining({ target: "cost_center" }),
        expect.objectContaining({ target: "dre_category" }),
        expect.objectContaining({ target: "catalog_item" }),
        expect.objectContaining({ target: "seller" }),
        expect.objectContaining({ target: "financial_transfer" }),
      ]),
    );
    for (const update of linkUpdates) {
      expect(update.metadata).toEqual(
        expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      );
    }
  });

  it("does not recreate existing Conta Azul receivable links", async () => {
    const requests: string[] = [];
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
      }),
      accessToken: "access-1",
      fetchImpl: async (input) => {
        requests.push(String(input));
        return Response.json({ id: "unexpected" });
      },
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "billing_document") return "remote-billing-1";
          return null;
        },
        async upsertLink() {
          throw new Error("should not update link");
        },
      },
    });

    await expect(
      adapter.exportBillingDocument({
        externalId: "billing_document:1",
        documentNumber: "FIN-1",
        organizationId: "org-1",
        unitId: null,
        unitName: null,
        customerExternalId: "customer:1",
        customerName: "Cliente Exemplo",
        totalCents: 15000,
        currency: "BRL",
        issueDate: "2026-05-24",
        dueDate: "2026-06-24",
        status: "issued",
        items: [],
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "remote-billing-1",
      remoteEntityType: "conta_azul_receivable_event",
    });
    expect(requests).toEqual([]);
  });

  it("exports Conta Azul sales after customer sync", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (String(input).endsWith("/v1/venda/proximo-numero")) {
        return Response.json(4512645);
      }
      return Response.json({ id: "remote-sale-1" });
    };
    const payload: IntegrationSalePayload = {
      externalId: "sale:1",
      organizationId: "org-1",
      customerExternalId: "customer:1",
      saleNumber: null,
      saleDate: "2026-05-24",
      status: "approved",
      sellerExternalId: null,
      categoryId: null,
      costCenterId: null,
      totalCents: 15000,
      currency: "BRL",
      notes: "Venda gerada pela OS 42",
      items: saleItems,
      paymentTerms: salePaymentTerms,
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultCategoryId: "category-1",
        defaultCostCenterId: "cost-center-1",
        defaultSellerId: "seller-1",
        exportMode: "sale",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportSale) {
      throw new Error("expected Conta Azul sale support");
    }

    await expect(adapter.exportSale(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-sale-1",
      remoteDisplayId: "4512645",
      remoteEntityType: "conta_azul_sale",
    });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/venda/proximo-numero",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda",
        method: "POST",
        body: {
          id_cliente: "remote-customer-1",
          numero: 4512645,
          situacao: "APROVADO",
          data_venda: "2026-05-24",
          id_categoria: "category-1",
          id_centro_custo: "cost-center-1",
          id_vendedor: "seller-1",
          observacoes: "Origem CalibraFácil: sale:1\nVenda gerada pela OS 42",
          itens: [
            {
              id: "remote-service-1",
              quantidade: 1,
              descricao: "Calibração",
              valor: 150,
            },
          ],
          condicao_pagamento: {
            tipo_pagamento: "BOLETO_BANCARIO",
            id_conta_financeira: "account-1",
            opcao_condicao_pagamento: "À vista",
            parcelas: [
              {
                data_vencimento: "2026-06-24",
                valor: 150,
                descricao: "Parcela 1",
              },
            ],
          },
        },
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "sale",
        localEntityId: "sale:1",
        remoteEntityId: "remote-sale-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_sale",
        metadata: {
          provider: "conta_azul",
          resource: "venda",
          exportMode: "sale",
          saleNumber: 4512645,
          matchedBy: "created",
        },
      },
    ]);
  });

  it("registers Conta Azul sale PDF metadata as a remote document", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (String(input).endsWith("/v1/venda/proximo-numero")) {
        return Response.json(4512645);
      }
      if (String(input).endsWith("/v1/venda/remote-sale-1/imprimir")) {
        return new Response(new Uint8Array([37, 80, 68, 70]).buffer, {
          headers: {
            "content-type": "application/pdf",
          },
        });
      }
      return Response.json({ id: "remote-sale-1" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          remoteDocuments: true,
        },
        exportMode: "sale",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportSale) {
      throw new Error("expected Conta Azul sale support");
    }

    await expect(
      adapter.exportSale({
        externalId: "sale:1",
        organizationId: "org-1",
        customerExternalId: "customer:1",
        saleNumber: null,
        saleDate: "2026-05-24",
        status: "approved",
        sellerExternalId: null,
        categoryId: null,
        costCenterId: null,
        totalCents: 15000,
        currency: "BRL",
        notes: "Venda gerada pela OS 42",
        items: saleItems,
        paymentTerms: salePaymentTerms,
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "remote-sale-1",
      remoteDisplayId: "4512645",
      remoteEntityType: "conta_azul_sale",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api-v2.contaazul.com/v1/venda/proximo-numero",
      "https://api-v2.contaazul.com/v1/venda",
      "https://api-v2.contaazul.com/v1/venda/remote-sale-1/imprimir",
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "sale",
        localEntityId: "sale:1",
        remoteEntityId: "remote-sale-1",
      }),
      {
        target: "remote_document",
        localEntityId: "sale:1:sale_pdf",
        remoteEntityId: "remote-sale-1:pdf",
        remoteDisplayId: "Venda 4512645 PDF",
        remoteEntityType: "conta_azul_sale_pdf",
        metadata: {
          provider: "conta_azul",
          resource: "venda/{id}/imprimir",
          source: "sale_export",
          documentKind: "sale_pdf",
          saleRemoteId: "remote-sale-1",
          saleNumber: 4512645,
          contentType: "application/pdf",
          byteLength: 4,
          downloadableViaApi: true,
          status: "available",
          syncedAt: expect.any(String),
        },
      },
    ]);
  });

  it("does not fail Conta Azul sale export when sale PDF is unavailable", async () => {
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith("/v1/venda/proximo-numero")) {
        return Response.json(4512645);
      }
      if (String(input).endsWith("/v1/venda/remote-sale-1/imprimir")) {
        return Response.json(
          { message: "Documento não encontrado" },
          {
            status: 404,
          },
        );
      }
      return Response.json({ id: "remote-sale-1" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          remoteDocuments: true,
        },
        exportMode: "sale",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportSale) {
      throw new Error("expected Conta Azul sale support");
    }

    await expect(
      adapter.exportSale({
        externalId: "sale:1",
        organizationId: "org-1",
        customerExternalId: "customer:1",
        saleNumber: null,
        saleDate: "2026-05-24",
        status: "approved",
        sellerExternalId: null,
        categoryId: null,
        costCenterId: null,
        totalCents: 15000,
        currency: "BRL",
        notes: null,
        items: saleItems,
        paymentTerms: salePaymentTerms,
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "remote-sale-1",
    });
    expect(linkUpdates).toContainEqual(
      expect.objectContaining({
        target: "remote_document",
        localEntityId: "sale:1:sale_pdf",
        remoteEntityId: "remote-sale-1:pdf",
        metadata: expect.objectContaining({
          documentKind: "sale_pdf",
          status: "unavailable",
          error: "Documento não encontrado",
        }),
      }),
    );
  });

  it("updates existing Conta Azul sale links", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (init?.method === "GET") {
        return Response.json({
          id: "remote-sale-1",
          numero: 4512645,
        });
      }
      return Response.json({ id: "remote-sale-1" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        exportMode: "sale",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (params.target === "sale") return "remote-sale-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportSale) {
      throw new Error("expected Conta Azul sale support");
    }

    await expect(
      adapter.exportSale({
        externalId: "sale:1",
        organizationId: "org-1",
        customerExternalId: "customer:1",
        saleNumber: null,
        saleDate: "2026-05-24",
        status: "draft",
        sellerExternalId: null,
        categoryId: "category-1",
        costCenterId: null,
        totalCents: 15000,
        currency: "BRL",
        notes: null,
        items: saleItems,
        paymentTerms: salePaymentTerms,
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "remote-sale-1",
      remoteDisplayId: "4512645",
      remoteEntityType: "conta_azul_sale",
    });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/venda/remote-sale-1",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/remote-sale-1",
        method: "PUT",
        body: expect.objectContaining({
          id_cliente: "remote-customer-1",
          numero: 4512645,
          situacao: "EM_ANDAMENTO",
          data_venda: "2026-05-24",
          id_categoria: "category-1",
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "sale",
        localEntityId: "sale:1",
        remoteEntityId: "remote-sale-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_sale",
        metadata: expect.objectContaining({
          matchedBy: "object_link",
          saleNumber: 4512645,
        }),
      }),
    ]);
  });

  it("creates Conta Azul recurring contracts with required terms, items and payment condition", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (String(input).endsWith("/v1/contratos/proximo-numero")) {
        return Response.json(4512645);
      }
      return Response.json({
        id: "remote-contract-1",
        id_venda: "contract-sale-1",
      });
    };
    const payload: IntegrationContractPayload = {
      externalId: "contract:1",
      organizationId: "org-1",
      customerExternalId: "customer:1",
      contractNumber: null,
      recurrence: "monthly",
      issueDate: "2026-05-24",
      startsAt: "2026-06-01",
      endsAt: "2027-06-01",
      sellerExternalId: "seller-1",
      totalCents: 15000,
      currency: "BRL",
      categoryId: "category-1",
      costCenterId: "cost-center-1",
      notes: "Contrato de calibração recorrente",
      items: saleItems,
      paymentTerms: {
        ...salePaymentTerms,
        firstDueDate: "2026-06-10",
        dueDate: "2026-06-10",
        dueDay: 10,
      },
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          if (
            params.target === "service" &&
            params.localEntityId === "service:1"
          ) {
            return "remote-service-1";
          }
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.upsertContract) {
      throw new Error("expected Conta Azul contract support");
    }

    await expect(adapter.upsertContract(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-contract-1",
      remoteDisplayId: "4512645",
      remoteEntityType: "conta_azul_contract",
    });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/contratos/proximo-numero",
        method: "GET",
        body: {},
      },
      {
        url: "https://api-v2.contaazul.com/v1/contratos",
        method: "POST",
        body: expect.objectContaining({
          id_cliente: "remote-customer-1",
          id_categoria: "category-1",
          id_centro_custo: "cost-center-1",
          id_vendedor: "seller-1",
          termos: expect.objectContaining({
            tipo_frequencia: "MENSAL",
            numero: 4512645,
          }),
          condicao_pagamento: expect.objectContaining({
            dia_vencimento: 10,
            primeira_data_vencimento: "2026-06-10",
          }),
          itens: [
            {
              id: "remote-service-1",
              quantidade: 1,
              descricao: "Calibração",
              valor: 150,
            },
          ],
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "contract",
        localEntityId: "contract:1",
        remoteEntityId: "remote-contract-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_contract",
        metadata: expect.objectContaining({
          resource: "contratos",
          contractNumber: 4512645,
          customerRemoteId: "remote-customer-1",
          startsAt: "2026-06-01",
          endsAt: "2027-06-01",
          generatedSales: true,
          generatedSaleRemoteId: "contract-sale-1",
        }),
      }),
      expect.objectContaining({
        target: "sale",
        localEntityId: "contract:1:generated-sale",
        remoteEntityId: "contract-sale-1",
        remoteDisplayId: "4512645",
        remoteEntityType: "conta_azul_contract_generated_sale",
        metadata: expect.objectContaining({
          resource: "contratos",
          source: "contract_generated",
          contractLocalEntityId: "contract:1",
          contractRemoteId: "remote-contract-1",
          contractNumber: 4512645,
          generatedByContract: true,
          revenueDuplicationGuard: true,
        }),
      }),
    ]);
  });

  it("links Conta Azul budget-like sales through the official sales search when orçamento write is unavailable", async () => {
    const payload: IntegrationBudgetPayload = {
      externalId: "budget:1",
      organizationId: "org-1",
      customerExternalId: "customer:1",
      budgetNumber: "1001",
      issueDate: "2026-05-24",
      expirationDate: "2026-06-24",
      status: "draft",
      sellerExternalId: null,
      categoryId: null,
      costCenterId: null,
      totalCents: 15000,
      currency: "BRL",
      notes: null,
      items: saleItems,
      paymentTerms: salePaymentTerms,
    };
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), method: init?.method });
      if (String(input).includes("/v1/venda/busca")) {
        return Response.json({
          itens: [
            {
              id: "remote-budget-1",
              numero: 1001,
              data: "2026-05-24",
              total: 150,
              situacao: { nome: "ORCAMENTO", descricao: "Orçamento" },
              cliente: { id: "remote-customer-1" },
            },
          ],
        });
      }

      return Response.json({ id: "unexpected" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportBudget) {
      throw new Error("expected Conta Azul budget support");
    }

    await expect(adapter.exportBudget(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-budget-1",
      remoteDisplayId: "1001",
      remoteEntityType: "conta_azul_budget_sale",
    });

    expect(requests).toHaveLength(1);
    const request = requests.at(0);
    if (!request) throw new Error("expected budget search request");
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api-v2.contaazul.com/v1/venda/busca",
    );
    expect(url.searchParams.get("pagina")).toBe("1");
    expect(url.searchParams.get("tamanho_pagina")).toBe("50");
    expect(url.searchParams.getAll("ids_clientes")).toEqual([
      "remote-customer-1",
    ]);
    expect(url.searchParams.getAll("situacoes")).toEqual([
      "ORCAMENTO",
      "ORCAMENTO_ACEITO",
      "ORCAMENTO_RECUSADO",
    ]);
    expect(url.searchParams.getAll("numeros")).toEqual(["1001"]);
    expect(url.searchParams.get("data_inicio")).toBe("2026-05-24");
    expect(url.searchParams.get("data_fim")).toBe("2026-05-24");
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "budget",
        localEntityId: "budget:1",
        remoteEntityId: "remote-budget-1",
        remoteDisplayId: "1001",
        remoteEntityType: "conta_azul_budget_sale",
        metadata: expect.objectContaining({
          resource: "venda/busca",
          budgetMode: "sales_search_link",
          consultationOnly: true,
          matchedBy: "sales_search_budget_situation",
          customerRemoteId: "remote-customer-1",
          budgetNumber: "1001",
          situation: "ORCAMENTO",
        }),
      }),
    ]);
  });

  it("keeps Conta Azul budget creation blocked when no remote orçamento can be linked", async () => {
    const payload: IntegrationBudgetPayload = {
      externalId: "budget:1",
      organizationId: "org-1",
      customerExternalId: "customer:1",
      budgetNumber: "ORC-1",
      issueDate: "2026-05-24",
      expirationDate: "2026-06-24",
      status: "draft",
      sellerExternalId: null,
      categoryId: null,
      costCenterId: null,
      totalCents: 15000,
      currency: "BRL",
      notes: null,
      items: saleItems,
      paymentTerms: salePaymentTerms,
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig(),
      accessToken: "access-1",
      fetchImpl: async (input) => {
        if (String(input).includes("/v1/venda/busca")) {
          return Response.json({ itens: [] });
        }

        return Response.json({ id: "unexpected" });
      },
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          return null;
        },
        async upsertLink() {
          throw new Error("unexpected link update");
        },
      },
    });

    if (!adapter.exportBudget) {
      throw new Error("expected Conta Azul budget support");
    }

    await expect(adapter.exportBudget(payload)).rejects.toThrow(
      "não há endpoint de integração de orçamentos",
    );
  });

  it("normalizes legacy native budget write mode to sales-search linkage", async () => {
    const requests: string[] = [];
    const linkUpdates: LinkUpdate[] = [];
    const payload: IntegrationBudgetPayload = {
      externalId: "budget:1",
      organizationId: "org-1",
      customerExternalId: "customer:1",
      budgetNumber: "1001",
      issueDate: "2026-05-24",
      expirationDate: "2026-06-24",
      status: "draft",
      sellerExternalId: null,
      categoryId: null,
      costCenterId: null,
      totalCents: 15000,
      currency: "BRL",
      notes: null,
      items: saleItems,
      paymentTerms: salePaymentTerms,
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        budgetMode: "native_api_write_verified",
      }),
      accessToken: "access-1",
      fetchImpl: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/v1/venda/busca")) {
          return Response.json({
            itens: [
              {
                id: "remote-budget-1",
                numero: 1001,
                data: "2026-05-24",
                total: 150,
                situacao: { nome: "ORCAMENTO", descricao: "Orçamento" },
                cliente: { id: "remote-customer-1" },
              },
            ],
          });
        }

        return Response.json({ id: "unexpected" });
      },
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "customer") return "remote-customer-1";
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportBudget) {
      throw new Error("expected Conta Azul budget support");
    }

    await expect(adapter.exportBudget(payload)).resolves.toMatchObject({
      remoteEntityId: "remote-budget-1",
      remoteEntityType: "conta_azul_budget_sale",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/v1/venda/busca");
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "budget",
        metadata: expect.objectContaining({
          budgetMode: "sales_search_link",
          consultationOnly: true,
        }),
      }),
    ]);
  });

  it("requires Conta Azul customers before exporting sales", async () => {
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        exportMode: "sale",
      }),
      accessToken: "access-1",
      fetchImpl: async () => Response.json({ id: "unexpected" }),
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink() {
          throw new Error("should not update link");
        },
      },
    });

    if (!adapter.exportSale) {
      throw new Error("expected Conta Azul sale support");
    }

    await expect(
      adapter.exportSale({
        externalId: "sale:1",
        organizationId: "org-1",
        customerExternalId: "customer:1",
        saleNumber: "1001",
        saleDate: "2026-05-24",
        status: "approved",
        sellerExternalId: null,
        categoryId: null,
        costCenterId: null,
        totalCents: 15000,
        currency: "BRL",
        notes: null,
        items: saleItems,
        paymentTerms: salePaymentTerms,
      }),
    ).rejects.toThrow("Cliente precisa ser sincronizado");
  });

  it("exports Conta Azul payables after supplier sync", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({
        // Live API returns the protocol id as `protocolo` (Portuguese).
        protocolo: "payable-protocol-1",
        status: "SUCCESS",
        createdAt: "2026-05-24T00:00:00Z",
      });
    };
    const payload: IntegrationPayablePayload = {
      externalId: "payable:1",
      organizationId: "org-1",
      supplierExternalId: "supplier:1",
      documentNumber: "TERC-1",
      issueDate: "2026-05-24",
      dueDate: "2026-06-24",
      competenceDate: "2026-05-01",
      amountCents: 15000,
      currency: "BRL",
      categoryId: "expense-category-1",
      costCenterId: "cost-center-1",
      notes: "Calibracao terceirizada",
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
        defaultExpenseCategoryId: "default-expense-category",
        defaultCostCenterId: "default-cost-center",
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "supplier") return "remote-supplier-1";
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportPayable) {
      throw new Error("expected Conta Azul payable support");
    }

    await expect(adapter.exportPayable(payload)).resolves.toMatchObject({
      remoteEntityId: "payable-protocol-1",
      remoteEntityType: "conta_azul_payable_protocol",
    });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-pagar",
        method: "POST",
        body: expect.objectContaining({
          contato: "remote-supplier-1",
          conta_financeira: "account-1",
          data_competencia: "2026-05-01",
          descricao: "Conta a pagar TERC-1",
          valor: 150,
          rateio: [
            {
              id_categoria: "expense-category-1",
              valor: 150,
              rateio_centro_custo: [
                {
                  id_centro_custo: "cost-center-1",
                  valor: 150,
                },
              ],
            },
          ],
        }),
      },
    ]);
    expect(linkUpdates).toEqual([
      {
        target: "payable",
        localEntityId: "payable:1",
        remoteEntityId: "payable-protocol-1",
        remoteDisplayId: "payable-protocol-1",
        remoteEntityType: "conta_azul_payable_protocol",
        metadata: {
          provider: "conta_azul",
          resource: "financeiro/eventos-financeiros/contas-a-pagar",
        },
      },
    ]);
  });

  it("keeps Conta Azul payable export successful when protocol lookup fails", async () => {
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith("/v1/protocolo/payable-protocol-1")) {
        return Response.json(
          { message: "Protocolo não encontrado" },
          {
            status: 404,
          },
        );
      }
      return Response.json({
        protocolId: "payable-protocol-1",
        status: "PENDING",
        createdAt: "2026-05-24T00:00:00Z",
      });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
        defaultExpenseCategoryId: "default-expense-category",
        protocolMode: "api_lookup_verified",
        enabledTargets: {
          protocols: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "supplier") return "remote-supplier-1";
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.exportPayable) {
      throw new Error("expected Conta Azul payable support");
    }

    await expect(
      adapter.exportPayable({
        externalId: "payable:1",
        organizationId: "org-1",
        supplierExternalId: "supplier:1",
        documentNumber: "TERC-1",
        issueDate: "2026-05-24",
        dueDate: "2026-06-24",
        competenceDate: "2026-05-01",
        amountCents: 15000,
        currency: "BRL",
        categoryId: null,
        costCenterId: null,
        notes: null,
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "payable-protocol-1",
      remoteEntityType: "conta_azul_payable_protocol",
    });
    expect(linkUpdates).toContainEqual(
      expect.objectContaining({
        target: "protocol",
        localEntityId: "payable:1:protocol",
        remoteEntityId: "payable-protocol-1",
        remoteEntityType: "conta_azul_protocol",
        metadata: expect.objectContaining({
          source: "payable_export",
          originTarget: "payable",
          originLocalEntityId: "payable:1",
          status: "unavailable",
          error: "Protocolo não encontrado",
        }),
      }),
    );
  });

  it("does not recreate existing Conta Azul payable links", async () => {
    const requests: string[] = [];
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
      }),
      accessToken: "access-1",
      fetchImpl: async (input) => {
        requests.push(String(input));
        return Response.json({ id: "unexpected" });
      },
      links: {
        async getExistingRemoteId(params) {
          if (params.target === "payable") return "remote-payable-1";
          return null;
        },
        async upsertLink() {
          throw new Error("should not update link");
        },
      },
    });

    if (!adapter.exportPayable) {
      throw new Error("expected Conta Azul payable support");
    }

    await expect(
      adapter.exportPayable({
        externalId: "payable:1",
        organizationId: "org-1",
        supplierExternalId: "supplier:1",
        documentNumber: "TERC-1",
        issueDate: "2026-05-24",
        dueDate: "2026-06-24",
        competenceDate: "2026-05-24",
        amountCents: 15000,
        currency: "BRL",
        categoryId: null,
        costCenterId: null,
        notes: null,
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "remote-payable-1",
      remoteEntityType: "conta_azul_payable_event",
    });
    expect(requests).toEqual([]);
  });

  it("polls Conta Azul payables into payable, installment and baixa links", async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method,
      });

      if (url.includes("/contas-a-pagar/buscar")) {
        return Response.json({
          itens: [
            {
              id: "payable-installment-1",
              data_alteracao: "2026-05-24T10:00:00",
            },
          ],
          itens_totais: 1,
        });
      }

      if (url.endsWith("/parcelas/payable-installment-1")) {
        return Response.json({
          id: "payable-installment-1",
          indice: 1,
          status: "QUITADO",
          valor_pago: 150,
          data_vencimento: "2026-06-24",
          data_alteracao: "2026-05-24T10:00:00",
          nota: "Origem CalibraFácil: payable:1",
          evento: {
            id: "payable-event-1",
            referencia: "payable:1",
          },
        });
      }

      if (url.endsWith("/parcelas/payable-installment-1/baixa")) {
        return Response.json([{ id: "baixa-1" }]);
      }

      return Response.json({ id: "unexpected" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          payables: true,
          baixas: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });
    const cursor: IntegrationSyncCursor = {
      cursorType: "conta_azul_payables",
      lastRemoteUpdatedAt: "2026-05-24T09:00:00.000Z",
      lastSuccessfulPollAt: null,
      nextPage: null,
      state: {
        requestedLimit: 10,
        windowEndAt: "2026-05-24T11:00:00.000Z",
        dueDateFrom: "2026-01-01",
        dueDateTo: "2026-12-31",
      },
    };

    if (!adapter.pollPayableStatus) {
      throw new Error("expected Conta Azul payable polling support");
    }

    await expect(adapter.pollPayableStatus(cursor)).resolves.toMatchObject({
      processedCount: 1,
      updatedCount: 1,
      cursor: {
        cursorType: "conta_azul_payables",
        lastRemoteUpdatedAt: "2026-05-24T11:00:00.000Z",
        nextPage: null,
      },
      warnings: [],
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?pagina=1&tamanho_pagina=10&data_vencimento_de=2026-01-01&data_vencimento_ate=2026-12-31&data_alteracao_de=2026-05-24T09%3A00%3A00&data_alteracao_ate=2026-05-24T11%3A00%3A00",
        method: "GET",
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/payable-installment-1",
        method: "GET",
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/payable-installment-1/baixa",
        method: "GET",
      },
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "payable",
        localEntityId: "payable:1",
        remoteEntityId: "payable-event-1",
        remoteEntityType: "conta_azul_payable_event",
      }),
      expect.objectContaining({
        target: "payable_installment",
        localEntityId: "payable:1:installment:1",
        remoteEntityId: "payable-installment-1",
        remoteEntityType: "conta_azul_payable_installment",
        metadata: expect.objectContaining({
          source: "payable_poll",
          status: "QUITADO",
          paidAmount: 150,
          acquittanceCount: 1,
        }),
      }),
      expect.objectContaining({
        target: "baixa",
        localEntityId: "baixa:baixa-1",
        remoteEntityId: "baixa-1",
        remoteEntityType: "conta_azul_baixa",
        metadata: expect.objectContaining({
          source: "payable_poll",
          installmentId: "payable-installment-1",
          payableExternalId: "payable:1",
        }),
      }),
    ]);
  });

  it("requires Conta Azul suppliers before exporting payables", async () => {
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        defaultFinancialAccountId: "account-1",
      }),
      accessToken: "access-1",
      fetchImpl: async () => Response.json({ id: "unexpected" }),
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink() {
          throw new Error("should not update link");
        },
      },
    });

    if (!adapter.exportPayable) {
      throw new Error("expected Conta Azul payable support");
    }

    await expect(
      adapter.exportPayable({
        externalId: "payable:1",
        organizationId: "org-1",
        supplierExternalId: "supplier:1",
        documentNumber: "TERC-1",
        issueDate: "2026-05-24",
        dueDate: "2026-06-24",
        competenceDate: "2026-05-24",
        amountCents: 15000,
        currency: "BRL",
        categoryId: null,
        costCenterId: null,
        notes: null,
      }),
    ).rejects.toThrow("Fornecedor precisa ser sincronizado");
  });

  it("links fiscal documents to MDF-e without storing full access keys", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(null, { status: 204 });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        fiscalMode: "consultation_only",
        enabledTargets: {
          fiscalDocuments: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.linkFiscalDocumentsToMdfe) {
      throw new Error("expected Conta Azul MDF-e linkage support");
    }

    await expect(
      adapter.linkFiscalDocumentsToMdfe({
        externalId: "mdfe:1",
        organizationId: "org-1",
        fiscalDocumentAccessKeys: [
          "42250323643586000108550010000001151606401726",
        ],
        mdfeIdentifier: "MDFE-345345",
        status: "ENCERRADO",
      }),
    ).resolves.toMatchObject({
      remoteEntityId: "MDFE-345345",
      remoteEntityType: "conta_azul_mdfe_link",
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais/vinculo-mdfe",
        method: "POST",
        body: {
          chaves_acesso: ["42250323643586000108550010000001151606401726"],
          identificador: "MDFE-345345",
          status: "ENCERRADO",
        },
      },
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "fiscal_document",
        localEntityId: "mdfe_link:mdfe:1",
        remoteEntityId: "MDFE-345345",
        remoteDisplayId: "MDFE-345345",
        remoteEntityType: "conta_azul_mdfe_link",
        metadata: expect.objectContaining({
          provider: "conta_azul",
          resource: "notas-fiscais/vinculo-mdfe",
          source: "mdfe_link",
          accessKeyCount: 1,
          accessKeys: [{ lastDigits: "401726", length: 44 }],
          consultationOnly: true,
          status: "ENCERRADO",
        }),
      }),
    ]);
    expect(JSON.stringify(linkUpdates[0]?.metadata)).not.toContain(
      "42250323643586000108550010000001151606401726",
    );
  });

  it("polls Conta Azul fiscal documents into fiscal object links", async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const linkUpdates: LinkUpdate[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
      });
      if (String(input).includes("/v1/notas-fiscais-servico")) {
        return Response.json({
          itens: [
            {
              id: "nfse-1",
              id_venda: "remote-sale-1",
              id_contrato: "remote-contract-1",
              data_competencia: "2026-05-14",
              documento_cliente: "11.222.333/0001-81",
              nome_cliente: "Cliente Exemplo",
              numero_nfse: 456,
              numero_venda: "1001",
              status: "EMITIDA",
              valor_total_nfse: 123.45,
              informacao_transmissao: {
                data_inicio_emissao: "2026-05-14T10:30:00",
              },
            },
          ],
          paginacao: {
            pagina_atual: 1,
            tamanho_pagina: 10,
            total_itens: 1,
            total_paginas: 1,
          },
        });
      }
      if (
        String(input).endsWith(
          "/v1/notas-fiscais/42250323643586000108550010000001151606401726",
        )
      ) {
        return new Response("<root>xml</root>", {
          headers: {
            "content-type": "application/xml",
          },
        });
      }

      return Response.json({
        itens: [
          {
            chave_acesso: "42250323643586000108550010000001151606401726",
            data_emissao: "2026-05-13T10:30:00Z",
            nome_destinatario: "EMPRESA EXEMPLO LTDA",
            numero_nota: 123456,
            status: "EMITIDA",
          },
        ],
        paginacao: {
          pagina_atual: 1,
          tamanho_pagina: 10,
          total_itens: 1,
          total_paginas: 1,
        },
      });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          ...normalizeContaAzulConnectionConfig().enabledTargets,
          fiscalDocuments: true,
          remoteDocuments: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.pollFiscalDocuments) {
      throw new Error("expected Conta Azul fiscal polling support");
    }

    await expect(
      adapter.pollFiscalDocuments({
        cursorType: "conta_azul_fiscal_documents",
        lastRemoteUpdatedAt: "2026-05-01T00:00:00.000Z",
        lastSuccessfulPollAt: null,
        nextPage: null,
        state: {
          requestedLimit: 10,
          windowEndAt: "2026-05-15T00:00:00.000Z",
        },
      }),
    ).resolves.toMatchObject({
      processedCount: 2,
      updatedCount: 2,
      cursor: {
        cursorType: "conta_azul_fiscal_documents",
        lastRemoteUpdatedAt: "2026-05-15T00:00:00.000Z",
        nextPage: null,
        state: {
          processedCount: 2,
          updatedCount: 2,
          documentType: null,
          windowEndAt: null,
        },
      },
      warnings: ["Modo fiscal da Conta Azul está configurado como consulta"],
    });

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais?data_inicial=2026-05-01&data_final=2026-05-15&pagina=1&tamanho_pagina=10",
        method: "GET",
      },
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais/42250323643586000108550010000001151606401726",
        method: "GET",
      },
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais-servico?data_competencia_de=2026-05-01&data_competencia_ate=2026-05-15&pagina=1&tamanho_pagina=10",
        method: "GET",
      },
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "fiscal_document",
        localEntityId: "nfe:42250323643586000108550010000001151606401726",
        remoteEntityId: "42250323643586000108550010000001151606401726",
        remoteDisplayId: "123456",
        remoteEntityType: "conta_azul_nfe",
        metadata: expect.objectContaining({
          provider: "conta_azul",
          resource: "notas-fiscais",
          source: "fiscal_poll",
          fiscal: expect.objectContaining({
            fiscalDocumentType: "nfe",
            consultationOnly: true,
            xmlAvailable: true,
          }),
        }),
      }),
      expect.objectContaining({
        target: "remote_document",
        localEntityId: "nfe:42250323643586000108550010000001151606401726:xml",
        remoteEntityId: "42250323643586000108550010000001151606401726:xml",
        remoteDisplayId: "Nota fiscal 123456 XML",
        remoteEntityType: "conta_azul_fiscal_xml",
        metadata: expect.objectContaining({
          provider: "conta_azul",
          resource: "notas-fiscais/{chave}",
          source: "fiscal_poll",
          documentKind: "fiscal_xml",
          fiscalDocumentType: "nfe",
          accessKey: "42250323643586000108550010000001151606401726",
          number: "123456",
          contentType: "application/xml",
          byteLength: 16,
          downloadableViaApi: true,
          status: "available",
        }),
      }),
      expect.objectContaining({
        target: "fiscal_document",
        localEntityId: "nfse:nfse-1",
        remoteEntityId: "nfse-1",
        remoteDisplayId: "456",
        remoteEntityType: "conta_azul_nfse",
        metadata: expect.objectContaining({
          provider: "conta_azul",
          resource: "notas-fiscais-servico",
          source: "fiscal_poll",
          fiscal: expect.objectContaining({
            fiscalDocumentType: "nfse",
            saleRemoteId: "remote-sale-1",
            contractRemoteId: "remote-contract-1",
            totalAmountCents: 12345,
            consultationOnly: true,
          }),
        }),
      }),
    ]);
  });

  it("marks missing Conta Azul remote links as drift during drift polling", async () => {
    const linkUpdates: LinkUpdate[] = [];
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/v1/venda/remote-sale-missing")) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      if (url.includes("/v1/servicos")) {
        return Response.json({
          itens: [
            {
              id: "remote-service-5",
              descricao: "Calibração dimensional",
              id_externo: "service:5",
              status: "ATIVO",
              tipo_servico: "PRESTADO",
            },
          ],
        });
      }
      if (url.includes("/v1/venda/busca")) {
        return Response.json({
          itens: [
            {
              id: "remote-budget-1",
              numero: 1001,
              situacao: { nome: "ORCAMENTO", descricao: "Orçamento" },
              cliente: { id: "remote-customer-1" },
            },
          ],
        });
      }
      if (url.includes("/v1/contratos")) {
        return Response.json({
          items: [
            {
              id: "remote-contract-1",
              numero: 4512645,
              status: "ATIVO",
            },
          ],
        });
      }
      if (url.endsWith("/v1/venda/remote-sale-1/imprimir")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
        });
      }
      if (
        url.endsWith(
          "/v1/notas-fiscais/42250323643586000108550010000001151606401726",
        )
      ) {
        return new Response("<root>xml</root>", {
          headers: { "content-type": "application/xml" },
        });
      }
      if (url.includes("/v1/notas-fiscais-servico")) {
        return Response.json({
          itens: [{ id: "nfse-1", data_competencia: "2026-05-14" }],
          paginacao: {
            pagina_atual: 1,
            tamanho_pagina: 10,
            total_itens: 1,
            total_paginas: 1,
          },
        });
      }
      if (
        url.endsWith(
          "/v1/financeiro/eventos-financeiros/parcelas/payable-installment-1",
        )
      ) {
        return Response.json({ id: "payable-installment-1" });
      }
      if (
        url.endsWith(
          "/v1/financeiro/eventos-financeiros/parcelas/baixa/baixa-1",
        )
      ) {
        return Response.json({ id: "baixa-1" });
      }
      return Response.json({ id: "ok" });
    };
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      config: normalizeContaAzulConnectionConfig({
        enabledTargets: {
          driftChecks: true,
        },
      }),
      accessToken: "access-1",
      fetchImpl,
      links: {
        async getExistingRemoteId() {
          return null;
        },
        async listLinks() {
          return [
            {
              target: "customer",
              localEntityId: "customer:1",
              remoteEntityId: "remote-customer-1",
              remoteEntityType: "conta_azul_pessoa",
              metadata: { provider: "conta_azul" },
            },
            {
              target: "catalog_item",
              localEntityId: "service:5",
              remoteEntityId: "remote-service-5",
              remoteEntityType: "conta_azul_service",
              metadata: {
                provider: "conta_azul",
                source: "reference_catalog_external_id",
                consultationOnly: true,
                matchedBy: "id_externo",
                referenceMetadata: { externalId: "service:5" },
              },
            },
            {
              target: "budget",
              localEntityId: "service_order:1",
              remoteEntityId: "remote-budget-1",
              remoteEntityType: "conta_azul_budget_sale",
              metadata: {
                provider: "conta_azul",
                resource: "venda/busca",
                consultationOnly: true,
                customerRemoteId: "remote-customer-1",
                budgetNumber: "1001",
                issueDate: "2026-05-24",
                situation: "ORCAMENTO",
              },
            },
            {
              target: "sale",
              localEntityId: "sale:1",
              remoteEntityId: "remote-sale-missing",
              remoteEntityType: "conta_azul_sale",
              metadata: { provider: "conta_azul" },
            },
            {
              target: "contract",
              localEntityId: "contract:1",
              remoteEntityId: "remote-contract-1",
              remoteEntityType: "conta_azul_contract",
              metadata: {
                provider: "conta_azul",
                contractNumber: 4512645,
                customerRemoteId: "remote-customer-1",
                startsAt: "2026-06-01",
                endsAt: "2027-06-01",
              },
            },
            {
              target: "fiscal_document",
              localEntityId: "nfe:42250323643586000108550010000001151606401726",
              remoteEntityId: "42250323643586000108550010000001151606401726",
              remoteEntityType: "conta_azul_nfe",
              metadata: { provider: "conta_azul" },
            },
            {
              target: "fiscal_document",
              localEntityId: "nfse:nfse-1",
              remoteEntityId: "nfse-1",
              remoteEntityType: "conta_azul_nfse",
              metadata: {
                provider: "conta_azul",
                fiscal: {
                  issuedAt: "2026-05-14T10:30:00",
                  rawMetadata: { data_competencia: "2026-05-14" },
                },
              },
            },
            {
              target: "remote_document",
              localEntityId: "sale:1:sale_pdf",
              remoteEntityId: "remote-sale-1:pdf",
              remoteEntityType: "conta_azul_sale_pdf",
              metadata: {
                provider: "conta_azul",
                saleRemoteId: "remote-sale-1",
              },
            },
            {
              target: "remote_document",
              localEntityId:
                "nfe:42250323643586000108550010000001151606401726:xml",
              remoteEntityId:
                "42250323643586000108550010000001151606401726:xml",
              remoteEntityType: "conta_azul_fiscal_xml",
              metadata: {
                provider: "conta_azul",
                accessKey: "42250323643586000108550010000001151606401726",
              },
            },
            {
              target: "payable_installment",
              localEntityId: "payable:1:installment:1",
              remoteEntityId: "payable-installment-1",
              remoteEntityType: "conta_azul_payable_installment",
              metadata: { provider: "conta_azul" },
            },
            {
              target: "baixa",
              localEntityId: "baixa:baixa-1",
              remoteEntityId: "baixa-1",
              remoteEntityType: "conta_azul_baixa",
              metadata: { provider: "conta_azul" },
            },
          ];
        },
        async upsertLink(params) {
          linkUpdates.push(params);
        },
      },
    });

    if (!adapter.pollRemoteDrift) {
      throw new Error("expected Conta Azul drift polling support");
    }

    await expect(
      adapter.pollRemoteDrift({
        cursorType: "conta_azul_remote_drift",
        lastRemoteUpdatedAt: null,
        lastSuccessfulPollAt: null,
        nextPage: null,
        state: { requestedLimit: 50 },
      }),
    ).resolves.toMatchObject({
      processedCount: 11,
      updatedCount: 11,
      warnings: [],
    });
    expect(requests).toEqual([
      "https://api-v2.contaazul.com/v1/pessoas/remote-customer-1",
      "https://api-v2.contaazul.com/v1/servicos?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/venda/busca?pagina=1&tamanho_pagina=50&situacoes=ORCAMENTO&situacoes=ORCAMENTO_ACEITO&situacoes=ORCAMENTO_RECUSADO&ids_clientes=remote-customer-1&numeros=1001&data_inicio=2026-05-24&data_fim=2026-05-24",
      "https://api-v2.contaazul.com/v1/venda/remote-sale-missing",
      "https://api-v2.contaazul.com/v1/contratos?pagina=1&tamanho_pagina=50&data_inicio=2026-06-01&data_fim=2027-06-01&cliente_id=remote-customer-1",
      "https://api-v2.contaazul.com/v1/notas-fiscais/42250323643586000108550010000001151606401726",
      "https://api-v2.contaazul.com/v1/notas-fiscais-servico?ids=nfse-1&data_competencia_de=2026-05-14&data_competencia_ate=2026-05-14&pagina=1&tamanho_pagina=10",
      "https://api-v2.contaazul.com/v1/venda/remote-sale-1/imprimir",
      "https://api-v2.contaazul.com/v1/notas-fiscais/42250323643586000108550010000001151606401726",
      "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/payable-installment-1",
      "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/baixa-1",
    ]);
    expect(linkUpdates).toEqual([
      expect.objectContaining({
        target: "customer",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "catalog_item",
        localEntityId: "service:5",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "budget",
        localEntityId: "service_order:1",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "sale",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_missing",
            reason: "not_found",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "contract",
        localEntityId: "contract:1",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "fiscal_document",
        localEntityId: "nfe:42250323643586000108550010000001151606401726",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "fiscal_document",
        localEntityId: "nfse:nfse-1",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "remote_document",
        localEntityId: "sale:1:sale_pdf",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "remote_document",
        localEntityId: "nfe:42250323643586000108550010000001151606401726:xml",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "payable_installment",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
      expect.objectContaining({
        target: "baixa",
        metadata: expect.objectContaining({
          drift: expect.objectContaining({
            status: "remote_present",
            source: "drift_poll",
          }),
        }),
      }),
    ]);
  });
});
