import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeContaAzulConnectionConfig } from "@calibra-facil/shared";
import {
  mapBillingDocumentToReceivableEvent,
  mapCatalogItemToContaAzulProduct,
  mapCatalogItemToContaAzulServico,
  mapContaAzulInstallmentStatus,
  mapContaAzulProductInvoiceToFiscalMetadata,
  mapContaAzulServiceInvoiceToFiscalMetadata,
  mapContractToContaAzulContract,
  mapCustomerToContaAzulPessoa,
  mapMdfeLinkToContaAzulPayload,
  mapPayableToContaAzulPayableEvent,
  mapPessoaToContaAzulPessoa,
  mapSaleToContaAzulSale,
} from "../conta-azul-mappers";
import type {
  IntegrationBillingDocumentPayload,
  IntegrationCatalogItemPayload,
  IntegrationContractPayload,
  IntegrationCustomerPayload,
  IntegrationPayablePayload,
  IntegrationSalePayload,
  IntegrationSupplierPayload,
  IntegrationTransporterPayload,
} from "@calibra-facil/shared";

const customerPayload: IntegrationCustomerPayload = {
  externalId: "customer:1",
  organizationId: "org-1",
  name: " Cliente Exemplo ",
  taxId: "11.222.333/0001-81",
  email: " FINANCEIRO@EXAMPLE.COM ",
  phone: "(11) 99999-0000",
  address: null,
  createdAt: null,
  updatedAt: null,
};

const billingPayload: IntegrationBillingDocumentPayload = {
  externalId: "billing_document:1",
  documentNumber: "FIN-1",
  organizationId: "org-1",
  unitId: 1,
  unitName: "Laboratório SP",
  customerExternalId: "customer:1",
  customerName: "Cliente Exemplo",
  totalCents: 12345,
  currency: "BRL",
  issueDate: "2026-05-24T10:00:00.000Z",
  dueDate: "2026-06-24",
  status: "issued",
  items: [
    {
      lineId: "line-1",
      jobId: "job-1",
      description: "Calibração de balança",
      quantity: 1,
      unitPriceCents: 12345,
      totalCents: 12345,
    },
  ],
};

const catalogProductPayload: IntegrationCatalogItemPayload = {
  externalId: "product:1",
  organizationId: "org-1",
  kind: "product",
  code: "PESO-001",
  name: " Peso padrão ",
  description: " Peso classe F1 ",
  priceCents: 12345,
  currency: "BRL",
  unitOfMeasureId: "unit-1",
  categoryId: null,
  fiscalMetadata: {
    ncmId: 123,
    cestId: "cest-1",
    origem: "NACIONAL",
    tipoProduto: "MERCADORIA_PARA_REVENDA",
  },
  active: true,
};

const payablePayload: IntegrationPayablePayload = {
  externalId: "payable:1",
  organizationId: "org-1",
  supplierExternalId: "supplier:1",
  documentNumber: "TERC-1",
  issueDate: "2026-05-24",
  dueDate: "2026-06-24",
  competenceDate: "2026-05-01",
  amountCents: 12345,
  currency: "BRL",
  categoryId: null,
  costCenterId: null,
  notes: "Calibração terceirizada",
};

const salePayload: IntegrationSalePayload = {
  externalId: "sale:1",
  organizationId: "org-1",
  customerExternalId: "customer:1",
  saleNumber: null,
  saleDate: "2026-05-24T10:00:00.000Z",
  status: "approved",
  sellerExternalId: null,
  categoryId: null,
  costCenterId: null,
  totalCents: 12345,
  currency: "BRL",
  notes: "Venda gerada pela OS 42",
  items: [
    {
      lineId: "line:1",
      catalogItemExternalId: "service:1",
      remoteItemId: "remote-service-1",
      description: "Calibração de balança",
      quantity: 1,
      unitPriceCents: 12345,
      totalCents: 12345,
    },
  ],
  paymentTerms: {
    paymentMethodId: "BOLETO_BANCARIO",
    financialAccountId: "account-1",
    paymentConditionLabel: "À vista",
    dueDate: "2026-06-24",
    installments: [],
  },
};

const contractPayload: IntegrationContractPayload = {
  externalId: "contract:1",
  organizationId: "org-1",
  customerExternalId: "customer:1",
  contractNumber: null,
  recurrence: "monthly",
  issueDate: "2026-05-24",
  startsAt: "2026-06-01",
  endsAt: "2027-06-01",
  sellerExternalId: null,
  totalCents: 12345,
  currency: "BRL",
  categoryId: null,
  costCenterId: null,
  notes: "Contrato de calibração recorrente",
  items: salePayload.items,
  paymentTerms: {
    paymentMethodId: "BOLETO_BANCARIO",
    financialAccountId: "account-1",
    paymentConditionLabel: "Mensal",
    dueDate: "2026-06-10",
    firstDueDate: "2026-06-10",
    dueDay: 10,
    installments: [],
  },
};

describe("Conta Azul mappers", () => {
  // Pin "today" so contract due-date roll-forward is deterministic. Only the
  // contract mapper reads the current date; other mappers use provided dates.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps CNPJ customers to Pessoa payloads with Cliente profile", () => {
    expect(mapCustomerToContaAzulPessoa(customerPayload)).toMatchObject({
      ativo: true,
      nome: "Cliente Exemplo",
      tipo_pessoa: "Jurídica",
      cnpj: "11222333000181",
      email: "financeiro@example.com",
      telefone_comercial: "11999990000",
      perfis: [{ tipo_perfil: "Cliente" }],
    });
  });

  it("maps suppliers and transporters to Pessoa profile-specific payloads", () => {
    const supplierPayload: IntegrationSupplierPayload = {
      ...customerPayload,
      externalId: "supplier:1",
      name: " Laboratório terceiro ",
      pessoaRole: "supplier",
    };
    const transporterPayload: IntegrationTransporterPayload = {
      ...customerPayload,
      externalId: "transporter:1",
      name: " Transportadora Exemplo ",
      pessoaRole: "transporter",
    };

    expect(mapPessoaToContaAzulPessoa(supplierPayload)).toMatchObject({
      nome: "Laboratório terceiro",
      perfis: [{ tipo_perfil: "Fornecedor" }],
      cnpj: "11222333000181",
    });
    expect(mapPessoaToContaAzulPessoa(transporterPayload)).toMatchObject({
      nome: "Transportadora Exemplo",
      perfis: [{ tipo_perfil: "Transportadora" }],
      cnpj: "11222333000181",
    });
  });

  it("maps structured customer address fields when available", () => {
    expect(
      mapCustomerToContaAzulPessoa({
        ...customerPayload,
        address: "Rua das Flores, 123, Centro, São Paulo, SP, 12345-678",
        addressParts: {
          street: " Rua das Flores ",
          number: "123",
          complement: "",
          neighbourhood: "Centro",
          city: "São Paulo",
          state: "sp",
          cep: "12345-678",
        },
      }),
    ).toMatchObject({
      enderecos: [
        {
          logradouro: "Rua das Flores",
          numero: "123",
          bairro: "Centro",
          cidade: "São Paulo",
          estado: "SP",
          cep: "12345678",
          pais: "Brasil",
        },
      ],
    });
  });

  it("maps CPF customers and rejects invalid tax identifiers", () => {
    expect(
      mapCustomerToContaAzulPessoa({
        ...customerPayload,
        taxId: "123.456.789-09",
      }),
    ).toMatchObject({
      tipo_pessoa: "Física",
      cpf: "12345678909",
    });

    expect(() =>
      mapCustomerToContaAzulPessoa({
        ...customerPayload,
        taxId: "123",
      }),
    ).toThrow("CPF/CNPJ do cliente deve ter 11 ou 14 caracteres");

    expect(() =>
      mapPessoaToContaAzulPessoa({
        ...customerPayload,
        pessoaRole: "supplier",
        taxId: "123",
      }),
    ).toThrow("CPF/CNPJ do fornecedor deve ter 11 ou 14 caracteres");
  });

  it("preserves an alphanumeric CNPJ (CNPJ alfanumérico) as Jurídica", () => {
    expect(
      mapCustomerToContaAzulPessoa({
        ...customerPayload,
        taxId: "12.ABC.345/01DE-35",
      }),
    ).toMatchObject({
      tipo_pessoa: "Jurídica",
      cnpj: "12ABC34501DE35",
    });
  });

  it("maps product catalog items to documented Conta Azul product payloads", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultProductCategoryId: "category-1",
      defaultCostCenterId: "cost-center-1",
      defaultUnitOfMeasureId: "unit-default",
      defaultFiscalTaxonomy: {
        fiscalUnitOfMeasureId: "fiscal-unit-1",
      },
    });

    expect(
      mapCatalogItemToContaAzulProduct(catalogProductPayload, config),
    ).toEqual({
      ativo: true,
      categoria: { id: "category-1" },
      codigo_sku: "PESO-001",
      descricao: "Peso classe F1",
      estoque: {
        valor_venda: 123.45,
      },
      fiscal: {
        cest: { id: "cest-1" },
        ncm: { id: 123 },
        origem: "NACIONAL",
        tipo_produto: "MERCADORIA_PARA_REVENDA",
        unidade_medida: { id: "fiscal-unit-1" },
      },
      formato: "SIMPLES",
      id_centro_custo: "cost-center-1",
      nome: "Peso padrão",
      status: "ATIVO",
      unidade_medida: { id: "unit-1" },
    });
  });

  it("rejects service items in the product mapper", () => {
    expect(() =>
      mapCatalogItemToContaAzulProduct(
        {
          ...catalogProductPayload,
          externalId: "service:1",
          kind: "service",
        },
        normalizeContaAzulConnectionConfig(),
      ),
    ).toThrow(/produto/);
  });

  it("maps material catalog payloads to products keyed by material:{id}", () => {
    const mapped = mapCatalogItemToContaAzulProduct(
      {
        ...catalogProductPayload,
        externalId: "material:7",
        code: "CEL-050",
        name: "Célula de carga 50kg",
        description: null,
        priceCents: 80_000,
        unitOfMeasureId: null,
        fiscalMetadata: null,
      },
      normalizeContaAzulConnectionConfig(),
    );

    expect(mapped).toMatchObject({
      codigo_sku: "CEL-050",
      nome: "Célula de carga 50kg",
      formato: "SIMPLES",
      status: "ATIVO",
      estoque: { valor_venda: 800 },
    });
  });

  it("never emits stock quantity — catalog sync sets price only (stock moves via sales)", () => {
    // The estoque/inventory rule: catalog upserts must not write quantities.
    // Saída happens via the exported Venda; entrada/ajuste is an explicit
    // action. And services must never fake stock fields at all.
    const product = mapCatalogItemToContaAzulProduct(
      { ...catalogProductPayload, externalId: "material:7" },
      normalizeContaAzulConnectionConfig(),
    );
    expect(Object.keys(product.estoque ?? {})).toEqual(["valor_venda"]);

    const servico = mapCatalogItemToContaAzulServico({
      ...catalogProductPayload,
      externalId: "service:1",
      kind: "service",
    });
    expect(servico).not.toHaveProperty("estoque");
  });

  it("maps service catalog items to the Conta Azul /v1/servicos shape", () => {
    const mapped = mapCatalogItemToContaAzulServico({
      ...catalogProductPayload,
      externalId: "service:1",
      kind: "service",
      code: "CAL-SERV-1",
      name: "Calibração de balança",
      priceCents: 25_000,
      active: true,
    });

    expect(mapped).toEqual({
      codigo: "CAL-SERV-1",
      descricao: "Calibração de balança",
      preco: 250,
      status: "ATIVO",
      tipo_servico: "PRESTADO",
    });
  });

  it("rejects product items in the service mapper", () => {
    expect(() =>
      mapCatalogItemToContaAzulServico({
        ...catalogProductPayload,
        kind: "product",
      }),
    ).toThrow(/serviço/);
  });

  it("maps billing documents to receivable financial events", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultFinancialAccountId: "account-1",
      defaultCategoryId: "category-1",
      defaultCostCenterId: "cost-center-1",
    });

    expect(
      mapBillingDocumentToReceivableEvent(
        billingPayload,
        config,
        "remote-customer-1",
      ),
    ).toEqual({
      data_competencia: "2026-05-24",
      valor: 123.45,
      observacao:
        "Origem CalibraFácil: billing_document:1\nUnidade: Laboratório SP\nCalibração de balança",
      descricao: "Fatura FIN-1 - Cliente Exemplo",
      contato: "remote-customer-1",
      conta_financeira: "account-1",
      rateio: [
        {
          id_categoria: "category-1",
          valor: 123.45,
          rateio_centro_custo: [
            {
              id_centro_custo: "cost-center-1",
              valor: 123.45,
            },
          ],
        },
      ],
      condicao_pagamento: {
        parcelas: [
          {
            descricao: "Fatura FIN-1 - Cliente Exemplo",
            data_vencimento: "2026-06-24",
            nota: "Origem CalibraFácil: billing_document:1\nUnidade: Laboratório SP\nCalibração de balança",
            conta_financeira: "account-1",
            detalhe_valor: {
              valor_bruto: 123.45,
              valor_liquido: 123.45,
            },
          },
        ],
      },
    });
  });

  it("requires a default category for receivable events (Conta Azul rateio needs one)", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultFinancialAccountId: "account-1",
    });

    expect(() =>
      mapBillingDocumentToReceivableEvent(
        billingPayload,
        config,
        "remote-customer-1",
      ),
    ).toThrow(/categoria financeira padrão/);
  });

  it("maps sales to documented Conta Azul sale payloads", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
      defaultCostCenterId: "cost-center-1",
      defaultSellerId: "seller-1",
    });

    expect(
      mapSaleToContaAzulSale(salePayload, config, "remote-customer-1", 4512645),
    ).toEqual({
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
          descricao: "Calibração de balança",
          valor: 123.45,
        },
      ],
      condicao_pagamento: {
        tipo_pagamento: "BOLETO_BANCARIO",
        id_conta_financeira: "account-1",
        opcao_condicao_pagamento: "À vista",
        parcelas: [
          {
            data_vencimento: "2026-06-24",
            valor: 123.45,
            descricao: "Parcela 1",
          },
        ],
      },
    });

    expect(() =>
      mapSaleToContaAzulSale(
        {
          ...salePayload,
          status: "canceled",
        },
        config,
        "remote-customer-1",
        4512645,
      ),
    ).toThrow("Venda cancelada não deve ser exportada");
  });

  it("maps the sale payment method to the commercial enum (PIX -> COBRANCA_PIX)", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
      defaultCostCenterId: "cost-center-1",
      defaultSellerId: "seller-1",
    });

    const pix = mapSaleToContaAzulSale(
      {
        ...salePayload,
        paymentTerms: { ...salePayload.paymentTerms, paymentMethodId: "PIX" },
      },
      config,
      "remote-customer-1",
      4512645,
    );
    // /v1/venda uses COBRANCA_PIX (commercial enum), NOT the financial-side
    // PIX_COBRANCA — verified against the live API.
    expect(pix.condicao_pagamento.tipo_pagamento).toBe("COBRANCA_PIX");

    const link = mapSaleToContaAzulSale(
      {
        ...salePayload,
        paymentTerms: {
          ...salePayload.paymentTerms,
          paymentMethodId: "CARTAO_CREDITO_VIA_LINK",
        },
      },
      config,
      "remote-customer-1",
      4512645,
    );
    expect(link.condicao_pagamento.tipo_pagamento).toBe("LINK_PAGAMENTO");
  });

  it("maps recurring contracts to documented Conta Azul contract payloads", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
      defaultCostCenterId: "cost-center-1",
      defaultSellerId: "seller-1",
    });

    expect(
      mapContractToContaAzulContract(
        contractPayload,
        config,
        "remote-customer-1",
        4512645,
      ),
    ).toEqual({
      id_cliente: "remote-customer-1",
      data_emissao: "2026-05-24",
      id_categoria: "category-1",
      id_centro_custo: "cost-center-1",
      id_vendedor: "seller-1",
      observacoes:
        "Origem CalibraFácil: contract:1\nContrato de calibração recorrente",
      termos: {
        tipo_frequencia: "MENSAL",
        tipo_expiracao: "DATA",
        data_inicio: "2026-06-01",
        data_fim: "2027-06-01",
        intervalo_frequencia: 1,
        dia_emissao_venda: 1,
        numero: 4512645,
      },
      condicao_pagamento: {
        tipo_pagamento: "BOLETO_BANCARIO",
        id_conta_financeira: "account-1",
        dia_vencimento: 10,
        primeira_data_vencimento: "2026-06-10",
      },
      itens: [
        {
          id: "remote-service-1",
          quantidade: 1,
          descricao: "Calibração de balança",
          valor: 123.45,
        },
      ],
    });
  });

  it("maps the contract payment method to the contract enum (PIX -> COBRANCA_PIX)", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
      defaultCostCenterId: "cost-center-1",
      defaultSellerId: "seller-1",
    });

    const pix = mapContractToContaAzulContract(
      {
        ...contractPayload,
        paymentTerms: {
          ...contractPayload.paymentTerms,
          paymentMethodId: "PIX",
        },
      },
      config,
      "remote-customer-1",
      4512645,
    );
    // Contracts use COBRANCA_PIX, NOT the sales value PIX_COBRANCA.
    expect(pix.condicao_pagamento.tipo_pagamento).toBe("COBRANCA_PIX");

    const link = mapContractToContaAzulContract(
      {
        ...contractPayload,
        paymentTerms: {
          ...contractPayload.paymentTerms,
          paymentMethodId: "CARTAO_CREDITO_VIA_LINK",
        },
      },
      config,
      "remote-customer-1",
      4512645,
    );
    expect(link.condicao_pagamento.tipo_pagamento).toBe("LINK_PAGAMENTO");
  });

  it("requires a payment method for contracts (Conta Azul rejects a null condition)", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
    });

    expect(() =>
      mapContractToContaAzulContract(
        {
          ...contractPayload,
          paymentTerms: {
            ...contractPayload.paymentTerms,
            paymentMethodId: null,
          },
        },
        config,
        "remote-customer-1",
        4512645,
      ),
    ).toThrow(/método de pagamento padrão/);
  });

  it("requires a contract end date (Conta Azul needs data_fim on the recurrence)", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
    });

    expect(() =>
      mapContractToContaAzulContract(
        { ...contractPayload, endsAt: null },
        config,
        "remote-customer-1",
        4512645,
      ),
    ).toThrow("Data final do contrato");
  });

  it("rolls a past first due date forward to the next billing-day occurrence", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultCategoryId: "category-1",
    });

    // firstDueDate well in the past (day-of-month 10). "Today" is pinned to
    // 2026-05-28, so the next 10th on/after today is 2026-06-10.
    const result = mapContractToContaAzulContract(
      {
        ...contractPayload,
        paymentTerms: {
          ...contractPayload.paymentTerms,
          firstDueDate: "2024-01-10",
          dueDate: "2024-01-10",
          installments: [],
        },
      },
      config,
      "remote-customer-1",
      4512645,
    );

    expect(result.condicao_pagamento.primeira_data_vencimento).toBe(
      "2026-06-10",
    );
    // dia_vencimento stays consistent with the rolled date's day.
    expect(result.condicao_pagamento.dia_vencimento).toBe(10);
  });

  it("uses the customer's address.country when set, falling back to 'Brasil'", () => {
    const exterior = mapCustomerToContaAzulPessoa({
      ...customerPayload,
      addressParts: {
        cep: "12345678",
        street: "123 Main St",
        city: "Lisboa",
        country: "Portugal",
      },
    });
    expect(exterior.enderecos?.[0]).toMatchObject({ pais: "Portugal" });

    const domestic = mapCustomerToContaAzulPessoa({
      ...customerPayload,
      addressParts: {
        cep: "01000000",
        street: "Av. Paulista",
        city: "São Paulo",
      },
    });
    expect(domestic.enderecos?.[0]).toMatchObject({ pais: "Brasil" });
  });

  it("maps product invoice consultation results to fiscal metadata", () => {
    expect(
      mapContaAzulProductInvoiceToFiscalMetadata({
        chave_acesso: "42250323643586000108550010000001151606401726",
        data_emissao: "2026-05-24T10:30:00Z",
        nome_destinatario: "EMPRESA EXEMPLO LTDA",
        numero_nota: 123456,
        status: "EMITIDA",
      }),
    ).toEqual({
      fiscalDocumentType: "nfe",
      remoteEntityId: null,
      accessKey: "42250323643586000108550010000001151606401726",
      number: "123456",
      status: "EMITIDA",
      issuedAt: "2026-05-24T10:30:00Z",
      customerName: "EMPRESA EXEMPLO LTDA",
      customerDocument: null,
      saleRemoteId: null,
      contractRemoteId: null,
      saleNumber: null,
      totalAmountCents: null,
      xmlAvailable: true,
      consultationOnly: true,
      rawMetadata: {
        chave_acesso: "42250323643586000108550010000001151606401726",
        numero_nota: "123456",
        status: "EMITIDA",
        data_emissao: "2026-05-24T10:30:00Z",
        nome_destinatario: "EMPRESA EXEMPLO LTDA",
      },
    });
  });

  it("maps service invoice consultation results to fiscal metadata", () => {
    expect(
      mapContaAzulServiceInvoiceToFiscalMetadata({
        id: "nfse-1",
        id_venda: "sale-1",
        id_contrato: "contract-1",
        data_competencia: "2026-05-24",
        documento_cliente: "11.222.333/0001-81",
        nome_cliente: "Cliente Exemplo",
        numero_nfse: 456,
        numero_rps: 789,
        numero_venda: "1001",
        status: "EMITIDA",
        valor_total_nfse: 123.45,
        cidade_emissao: {
          estado: "SC",
          nome: "Joinville",
        },
        informacao_transmissao: {
          data_inicio_emissao: "2026-05-24T10:30:00",
        },
      }),
    ).toEqual({
      fiscalDocumentType: "nfse",
      remoteEntityId: "nfse-1",
      accessKey: null,
      number: "456",
      status: "EMITIDA",
      issuedAt: "2026-05-24T10:30:00",
      customerName: "Cliente Exemplo",
      customerDocument: "11222333000181",
      saleRemoteId: "sale-1",
      contractRemoteId: "contract-1",
      saleNumber: "1001",
      totalAmountCents: 12345,
      xmlAvailable: false,
      consultationOnly: true,
      rawMetadata: {
        id: "nfse-1",
        id_venda: "sale-1",
        id_contrato: "contract-1",
        numero_nfse: "456",
        numero_rps: "789",
        numero_venda: "1001",
        status: "EMITIDA",
        data_competencia: "2026-05-24",
        data_inicio_emissao: "2026-05-24T10:30:00",
        data_inicio_cancelamento: null,
        documento_cliente: "11222333000181",
        nome_cliente: "Cliente Exemplo",
        valor_total_nfse: 123.45,
        cidade_emissao: {
          estado: "SC",
          nome: "Joinville",
        },
        cancelamento: null,
      },
    });
  });

  it("maps MDF-e linkage requests to the official fiscal payload", () => {
    expect(
      mapMdfeLinkToContaAzulPayload({
        externalId: "mdfe:1",
        organizationId: "org-1",
        fiscalDocumentAccessKeys: [
          "4225 0323 6435 8600 0108 5500 1000 0001 1516 0640 1726",
          "42250323643586000108550010000001151606401726",
        ],
        mdfeIdentifier: " MDFE-345345 ",
        status: "ENCERRADO",
      }),
    ).toEqual({
      chaves_acesso: ["42250323643586000108550010000001151606401726"],
      identificador: "MDFE-345345",
      status: "ENCERRADO",
    });

    expect(() =>
      mapMdfeLinkToContaAzulPayload({
        externalId: "mdfe:1",
        organizationId: "org-1",
        fiscalDocumentAccessKeys: ["123"],
        mdfeIdentifier: "MDFE-345345",
        status: null,
      }),
    ).toThrow("Chave de acesso fiscal para MDF-e deve ter 44 dígitos");
  });

  it("requires account, customer, dates, and positive totals for receivables", () => {
    const config = normalizeContaAzulConnectionConfig();

    expect(() =>
      mapBillingDocumentToReceivableEvent(
        billingPayload,
        config,
        "remote-customer-1",
      ),
    ).toThrow("Conta financeira padrão da Conta Azul não configurada");

    expect(() =>
      mapBillingDocumentToReceivableEvent(
        { ...billingPayload, issueDate: null },
        normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
        }),
        "remote-customer-1",
      ),
    ).toThrow("Data de competência é obrigatório");

    expect(() =>
      mapBillingDocumentToReceivableEvent(
        { ...billingPayload, totalCents: 0 },
        normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
        }),
        "remote-customer-1",
      ),
    ).toThrow("Valor da fatura deve ser maior que zero");
  });

  it("maps payables to Conta Azul payable financial events", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultFinancialAccountId: "account-1",
      defaultExpenseCategoryId: "expense-category-1",
      defaultCostCenterId: "cost-center-1",
    });

    expect(
      mapPayableToContaAzulPayableEvent(
        payablePayload,
        config,
        "remote-supplier-1",
      ),
    ).toEqual({
      data_competencia: "2026-05-01",
      valor: 123.45,
      observacao: "Origem CalibraFácil: payable:1\nCalibração terceirizada",
      descricao: "Conta a pagar TERC-1",
      contato: "remote-supplier-1",
      conta_financeira: "account-1",
      rateio: [
        {
          id_categoria: "expense-category-1",
          valor: 123.45,
          rateio_centro_custo: [
            {
              id_centro_custo: "cost-center-1",
              valor: 123.45,
            },
          ],
        },
      ],
      condicao_pagamento: {
        parcelas: [
          {
            descricao: "Conta a pagar TERC-1",
            data_vencimento: "2026-06-24",
            nota: "Origem CalibraFácil: payable:1\nCalibração terceirizada",
            conta_financeira: "account-1",
            detalhe_valor: {
              valor_bruto: 123.45,
              valor_liquido: 123.45,
            },
          },
        ],
      },
    });
  });

  it("uses payable payload category and cost center overrides", () => {
    const config = normalizeContaAzulConnectionConfig({
      defaultFinancialAccountId: "account-1",
      defaultExpenseCategoryId: "default-expense-category",
      defaultCostCenterId: "default-cost-center",
    });

    expect(
      mapPayableToContaAzulPayableEvent(
        {
          ...payablePayload,
          categoryId: "payload-expense-category",
          costCenterId: "payload-cost-center",
        },
        config,
        "remote-supplier-1",
      ),
    ).toMatchObject({
      rateio: [
        {
          id_categoria: "payload-expense-category",
          rateio_centro_custo: [
            {
              id_centro_custo: "payload-cost-center",
            },
          ],
        },
      ],
    });
  });

  it("requires account, supplier, dates, and positive totals for payables", () => {
    expect(() =>
      mapPayableToContaAzulPayableEvent(
        payablePayload,
        normalizeContaAzulConnectionConfig(),
        "remote-supplier-1",
      ),
    ).toThrow("Conta financeira padrão da Conta Azul não configurada");

    expect(() =>
      mapPayableToContaAzulPayableEvent(
        { ...payablePayload, dueDate: null },
        normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
        }),
        "remote-supplier-1",
      ),
    ).toThrow("Data de vencimento da conta a pagar é obrigatório");

    expect(() =>
      mapPayableToContaAzulPayableEvent(
        { ...payablePayload, amountCents: 0 },
        normalizeContaAzulConnectionConfig({
          defaultFinancialAccountId: "account-1",
        }),
        "remote-supplier-1",
      ),
    ).toThrow("Valor da conta a pagar deve ser maior que zero");
  });

  it("maps Conta Azul installment statuses to local finance statuses", () => {
    expect(
      mapContaAzulInstallmentStatus({
        id: "installment-1",
        status: "PENDENTE",
      }),
    ).toMatchObject({
      billingDocumentStatus: "ISSUED",
      installmentStatus: "OPEN",
      requiresReview: false,
    });

    expect(
      mapContaAzulInstallmentStatus({
        id: "installment-1",
        status: "QUITADO",
        valor_pago: 123.45,
      }),
    ).toMatchObject({
      billingDocumentStatus: "PAID",
      installmentStatus: "PAID",
      paidAmount: 123.45,
    });

    expect(
      mapContaAzulInstallmentStatus({
        id: "installment-1",
        status: "RECEBIDO_PARCIAL",
        valor_pago: 50,
      }),
    ).toMatchObject({
      billingDocumentStatus: "ISSUED",
      installmentStatus: "OPEN",
      paidAmount: 50,
    });

    expect(
      mapContaAzulInstallmentStatus({
        id: "installment-1",
        status: "PERDIDO",
      }),
    ).toMatchObject({
      billingDocumentStatus: "VOID",
      installmentStatus: "VOID",
    });

    expect(
      mapContaAzulInstallmentStatus({
        id: "installment-1",
        status: "RENEGOCIADO",
      }),
    ).toMatchObject({
      billingDocumentStatus: "ISSUED",
      installmentStatus: "OPEN",
      requiresReview: true,
    });
  });
});
