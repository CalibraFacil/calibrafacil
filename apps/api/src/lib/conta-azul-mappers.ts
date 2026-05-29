import type {
  BillingDocumentStatus,
  ContaAzulConnectionConfig,
  IntegrationBillingDocumentPayload,
  IntegrationCatalogItemPayload,
  IntegrationCommercialItemPayload,
  IntegrationContractPayload,
  IntegrationCustomerPayload,
  IntegrationFiscalDocumentMetadata,
  IntegrationMdfeLinkPayload,
  IntegrationPaymentTermsPayload,
  IntegrationPayablePayload,
  IntegrationPessoaPayload,
  IntegrationSalePayload,
  ReceivableInstallmentStatus,
} from "@calibra-facil/shared";
import type {
  ContaAzulInstallment,
  ContaAzulCommercialItemPayload,
  ContaAzulContractPayload,
  ContaAzulMdfeLinkPayload,
  ContaAzulMdfeLinkStatus,
  ContaAzulPessoaPayload,
  ContaAzulPessoaPerfil,
  ContaAzulPayableEventCreate,
  ContaAzulProductPayload,
  ContaAzulProductInvoice,
  ContaAzulReceivableEventCreate,
  ContaAzulSalePayload,
  ContaAzulSaleStatus,
  ContaAzulServiceInvoice,
  ContaAzulServicoPayload,
} from "./conta-azul-client";

type PessoaRoleConfig = {
  label: string;
  perfil: ContaAzulPessoaPerfil;
};

const PESSOA_ROLE_CONFIG = {
  customer: {
    label: "cliente",
    perfil: "Cliente",
  },
  supplier: {
    label: "fornecedor",
    perfil: "Fornecedor",
  },
  transporter: {
    label: "transportadora",
    perfil: "Transportadora",
  },
} as const satisfies Record<
  IntegrationPessoaPayload["pessoaRole"],
  PessoaRoleConfig
>;

export type ContaAzulInstallmentStatusMapping = {
  billingDocumentStatus: BillingDocumentStatus;
  installmentStatus: ReceivableInstallmentStatus;
  paidAmount: number | null;
  dueDate: string | null;
  requiresReview: boolean;
};

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function optionalTrimmed(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Conta Azul's COMMERCIAL endpoints — both /v1/venda (sales) and /v1/contratos
// (recurring contracts) — share one `tipo_pagamento` enum, verified against the
// live API:
//   - PIX billing is `COBRANCA_PIX`
//   - the payment-link value is `LINK_PAGAMENTO`
// Note this is the INVERSE of the financial-event/baixa enum, where PIX billing
// is `PIX_COBRANCA` (handled separately). Translate a configured/generic method
// into the commercial enum. The contract endpoint additionally REQUIRES the
// field (a condition without it is rejected as "não pode ser nula").
function normalizeCommercialTipoPagamento(value: string | null): string | null {
  switch (value) {
    case "PIX":
    case "PIX_COBRANCA":
    case "COBRANCA_PIX":
      return "COBRANCA_PIX";
    case "CARTAO_CREDITO_VIA_LINK":
    case "LINK_PAGAMENTO":
      return "LINK_PAGAMENTO";
    default:
      return value;
  }
}

function optionalUpperState(value: string | null | undefined) {
  const trimmed = optionalTrimmed(value);
  return trimmed ? trimmed.toUpperCase().slice(0, 2) : null;
}

function optionalMetadataText(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalMetadataId(
  metadata: Record<string, unknown>,
  key: string,
): string | number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

function buildPessoaAddress(payload: IntegrationCustomerPayload) {
  const address = payload.addressParts;
  if (!address) return null;

  const mapped = {
    bairro: optionalTrimmed(address.neighbourhood),
    cep: onlyDigits(address.cep),
    cidade: optionalTrimmed(address.city),
    complemento: optionalTrimmed(address.complement),
    estado: optionalUpperState(address.state),
    logradouro: optionalTrimmed(address.street),
    numero: optionalTrimmed(address.number),
  };
  const hasMeaningfulField = Object.values(mapped).some(
    (value) => typeof value === "string" && value.length > 0,
  );

  if (!hasMeaningfulField) return null;

  return {
    ...Object.fromEntries(
      Object.entries(mapped).filter(
        ([, value]) => typeof value === "string" && value.length > 0,
      ),
    ),
    pais: optionalTrimmed(address.country) ?? "Brasil",
  };
}

function hashStableCode(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `CF-${(hash >>> 0).toString(36).toUpperCase()}`;
}

function toDateOnly(value: string | null, fieldName: string) {
  const trimmed = optionalTrimmed(value);
  if (!trimmed) {
    throw new Error(`${fieldName} é obrigatório para exportar para Conta Azul`);
  }

  const dateOnly = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new Error(`${fieldName} deve estar no formato YYYY-MM-DD`);
  }

  return dateOnly;
}

// Server "today" as a YYYY-MM-DD string (UTC). UTC is always >= Brazil local
// time (UTC-3), so a date >= this is never "anterior à data de hoje" for
// Conta Azul.
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

// Conta Azul rejects a contract `primeira_data_vencimento` in the past. For an
// active recurring contract whose configured first due date has already passed
// (common for contracts that started months ago), roll it forward to the next
// occurrence of the same billing day on/after today, preserving the day so the
// derived `dia_vencimento` stays consistent.
function rollDueDateForward(dateOnly: string, todayOnly: string): string {
  if (dateOnly >= todayOnly) return dateOnly;
  let year = Number(dateOnly.slice(0, 4));
  let month = Number(dateOnly.slice(5, 7)); // 1-based
  const day = Number(dateOnly.slice(8, 10));
  for (let i = 0; i < 1200; i += 1) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dayOfMonth = Math.min(day, lastDay);
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(
      dayOfMonth,
    ).padStart(2, "0")}`;
    if (candidate >= todayOnly) return candidate;
  }
  return dateOnly;
}

function centsToDecimal(cents: number, fieldName: string) {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`${fieldName} deve ser maior que zero`);
  }

  return Number((cents / 100).toFixed(2));
}

function centsToNonNegativeDecimal(cents: number, fieldName: string) {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`${fieldName} deve ser maior ou igual a zero`);
  }

  return Number((cents / 100).toFixed(2));
}

function decimalToNullableCents(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100);
}

function numberOrTextToString(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  return optionalTrimmed(value);
}

function buildBillingDescription(payload: IntegrationBillingDocumentPayload) {
  const parts = [
    payload.documentNumber ? `Fatura ${payload.documentNumber}` : "Fatura",
    payload.customerName,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" - ");
}

function buildBillingNote(payload: IntegrationBillingDocumentPayload) {
  const itemDescriptions = payload.items
    .map((item) => item.description.trim())
    .filter(Boolean);

  return [
    `Origem CalibraFácil: ${payload.externalId}`,
    payload.unitName ? `Unidade: ${payload.unitName}` : null,
    itemDescriptions.length > 0 ? itemDescriptions.join("; ") : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function buildPayableDescription(payload: IntegrationPayablePayload) {
  const documentNumber = optionalTrimmed(payload.documentNumber);
  return documentNumber
    ? `Conta a pagar ${documentNumber}`
    : "Conta a pagar CalibraFácil";
}

function buildPayableNote(payload: IntegrationPayablePayload) {
  return [
    `Origem CalibraFácil: ${payload.externalId}`,
    optionalTrimmed(payload.notes),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function buildSaleNote(payload: IntegrationSalePayload) {
  return [
    `Origem CalibraFácil: ${payload.externalId}`,
    optionalTrimmed(payload.notes),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function buildContractNote(payload: IntegrationContractPayload) {
  return [
    `Origem CalibraFácil: ${payload.externalId}`,
    optionalTrimmed(payload.notes),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function mapSaleStatus(status: string): ContaAzulSaleStatus {
  const normalized = status.trim().toLowerCase();
  if (
    normalized === "approved" ||
    normalized === "aprovado" ||
    normalized === "completed" ||
    normalized === "issued" ||
    normalized === "paid" ||
    normalized === "faturado"
  ) {
    return "APROVADO";
  }

  if (
    normalized === "canceled" ||
    normalized === "cancelled" ||
    normalized === "cancelado" ||
    normalized === "void"
  ) {
    throw new Error(
      "Venda cancelada não deve ser exportada como nova venda na Conta Azul",
    );
  }

  return "EM_ANDAMENTO";
}

function mapCommercialItems(
  items: IntegrationCommercialItemPayload[],
  context: string,
): ContaAzulCommercialItemPayload[] {
  if (items.length === 0) {
    throw new Error(`${context} deve ter pelo menos um item vinculado`);
  }

  return items.map((item) => {
    const remoteItemId = optionalTrimmed(item.remoteItemId);
    if (!remoteItemId) {
      throw new Error(
        `${context} possui item sem produto/serviço sincronizado na Conta Azul`,
      );
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`${context} possui item com quantidade inválida`);
    }

    const mapped: ContaAzulCommercialItemPayload = {
      id: remoteItemId,
      quantidade: item.quantity,
      valor: centsToDecimal(item.unitPriceCents, "Valor unitário do item"),
    };
    const descricao = optionalTrimmed(item.description);
    if (descricao) mapped.descricao = descricao;
    if (typeof item.unitCostCents === "number") {
      mapped.valor_custo = centsToNonNegativeDecimal(
        item.unitCostCents,
        "Valor de custo do item",
      );
    }

    return mapped;
  });
}

function mapSalePaymentCondition(
  paymentTerms: IntegrationPaymentTermsPayload | null,
  config: ContaAzulConnectionConfig,
  totalCents: number,
  fallbackDate: string,
) {
  if (!paymentTerms) {
    throw new Error("Condição de pagamento da venda é obrigatória");
  }

  const installments =
    paymentTerms.installments.length > 0
      ? paymentTerms.installments.map((installment) => ({
          data_vencimento: toDateOnly(
            installment.dueDate,
            "Vencimento da parcela",
          ),
          valor: centsToDecimal(installment.amountCents, "Valor da parcela"),
          ...(optionalTrimmed(installment.description)
            ? {
                descricao:
                  optionalTrimmed(installment.description) ?? undefined,
              }
            : {}),
        }))
      : [
          {
            data_vencimento: toDateOnly(
              paymentTerms.dueDate ?? fallbackDate,
              "Vencimento da venda",
            ),
            valor: centsToDecimal(totalCents, "Valor da venda"),
            descricao: "Parcela 1",
          },
        ];
  const paymentMethod = normalizeCommercialTipoPagamento(
    optionalTrimmed(
      paymentTerms.paymentMethodId ?? config.defaultPaymentMethodId,
    ),
  );
  const financialAccount = optionalTrimmed(
    paymentTerms.financialAccountId ?? config.defaultFinancialAccountId,
  );

  const condition = {
    opcao_condicao_pagamento:
      optionalTrimmed(paymentTerms.paymentConditionLabel) ?? "À vista",
    parcelas: installments,
    ...(paymentMethod ? { tipo_pagamento: paymentMethod } : {}),
    ...(financialAccount ? { id_conta_financeira: financialAccount } : {}),
  };

  return condition;
}

function mapContractFrequency(recurrence: string | null) {
  const normalized = optionalTrimmed(recurrence)?.toLowerCase();
  if (
    normalized === "annual" ||
    normalized === "anual" ||
    normalized === "yearly"
  ) {
    return "ANUAL" as const;
  }
  if (
    normalized === "monthly" ||
    normalized === "mensal" ||
    normalized === "month"
  ) {
    return "MENSAL" as const;
  }

  throw new Error("Recorrência do contrato deve ser mensal ou anual");
}

function mapContractPaymentCondition(
  paymentTerms: IntegrationPaymentTermsPayload | null,
  config: ContaAzulConnectionConfig,
) {
  if (!paymentTerms) {
    throw new Error("Condição de pagamento do contrato é obrigatória");
  }

  const firstDueDate =
    optionalTrimmed(paymentTerms.firstDueDate) ??
    optionalTrimmed(paymentTerms.dueDate) ??
    optionalTrimmed(paymentTerms.installments[0]?.dueDate);
  if (!firstDueDate) {
    throw new Error("Primeiro vencimento do contrato é obrigatório");
  }
  // Roll a past first-due-date forward to the next billing-day occurrence —
  // Conta Azul rejects a primeira_data_vencimento anterior à data de hoje.
  const parsedDueDate = rollDueDateForward(
    toDateOnly(firstDueDate, "Primeiro vencimento do contrato"),
    todayDateOnly(),
  );
  // Conta Azul requires `dia_vencimento` to equal the day-of-month of
  // `primeira_data_vencimento`; derive it from the (possibly rolled) date so
  // they always agree.
  const dueDay = Number(parsedDueDate.slice(8, 10));
  // Contracts REQUIRE a payment method (a condition without it is rejected as
  // "não pode ser nula"), and use the contract-specific enum.
  const paymentMethod = normalizeCommercialTipoPagamento(
    optionalTrimmed(
      paymentTerms.paymentMethodId ?? config.defaultPaymentMethodId,
    ),
  );
  if (!paymentMethod) {
    throw new Error(
      "Configure um método de pagamento padrão da Conta Azul antes de exportar contratos.",
    );
  }
  const financialAccount = optionalTrimmed(
    paymentTerms.financialAccountId ?? config.defaultFinancialAccountId,
  );

  return {
    dia_vencimento: dueDay,
    primeira_data_vencimento: parsedDueDate,
    tipo_pagamento: paymentMethod,
    ...(financialAccount ? { id_conta_financeira: financialAccount } : {}),
  };
}

export function mapPessoaToContaAzulPessoa(
  payload: IntegrationPessoaPayload,
): ContaAzulPessoaPayload {
  const roleConfig = PESSOA_ROLE_CONFIG[payload.pessoaRole];
  const nome = optionalTrimmed(payload.name);
  if (!nome) {
    throw new Error(
      `Nome do ${roleConfig.label} é obrigatório para Conta Azul`,
    );
  }

  const taxId = onlyDigits(payload.taxId);
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new Error(
      `CPF/CNPJ do ${roleConfig.label} deve ter 11 ou 14 dígitos`,
    );
  }

  const email = optionalTrimmed(payload.email)?.toLowerCase();
  const phone = onlyDigits(payload.phone);
  const pessoa: ContaAzulPessoaPayload = {
    ativo: true,
    codigo: hashStableCode(payload.externalId).slice(0, 20),
    nome,
    perfis: [{ tipo_perfil: roleConfig.perfil }],
    tipo_pessoa: taxId.length === 11 ? "Física" : "Jurídica",
  };

  if (taxId.length === 11) {
    pessoa.cpf = taxId;
  } else {
    pessoa.cnpj = taxId;
  }
  if (email) pessoa.email = email;
  if (phone) pessoa.telefone_comercial = phone;
  const address = buildPessoaAddress(payload);
  if (address) pessoa.enderecos = [address];

  return pessoa;
}

export function mapCustomerToContaAzulPessoa(
  payload: IntegrationCustomerPayload,
): ContaAzulPessoaPayload {
  return mapPessoaToContaAzulPessoa({
    ...payload,
    pessoaRole: "customer",
  });
}

/**
 * Map a service-kind catalog item to the Conta Azul /v1/servicos shape.
 *
 * Schema: https://developers.contaazul.com/_bundle/open-api-docs/open-api-service.yaml
 * (POST /v1/servicos → CriarServico, PATCH /v1/servicos/{id} → atualizar parcial)
 */
export function mapCatalogItemToContaAzulServico(
  payload: IntegrationCatalogItemPayload,
): ContaAzulServicoPayload {
  if (payload.kind !== "service") {
    throw new Error(
      "mapCatalogItemToContaAzulServico aceita apenas itens do tipo serviço",
    );
  }

  const descricao = optionalTrimmed(payload.name);
  if (!descricao) {
    throw new Error("Descrição do serviço é obrigatória para Conta Azul");
  }

  const mapped: ContaAzulServicoPayload = {
    // descricao is required (1..100 per CriarServico schema). Truncate
    // defensively rather than trip API-side validation on legacy names.
    descricao: descricao.slice(0, 100),
    status: payload.active ? "ATIVO" : "INATIVO",
    // The catalog represents services that the lab provides — always
    // PRESTADO (provided) on the Conta Azul side.
    tipo_servico: "PRESTADO",
  };

  const codigo =
    optionalTrimmed(payload.code)?.slice(0, 20) ??
    hashStableCode(payload.externalId).slice(0, 20);
  if (codigo) {
    mapped.codigo = codigo;
  }

  if (typeof payload.priceCents === "number") {
    mapped.preco = centsToNonNegativeDecimal(
      payload.priceCents,
      "Preço do serviço",
    );
  }

  return mapped;
}

export function mapCatalogItemToContaAzulProduct(
  payload: IntegrationCatalogItemPayload,
  config: ContaAzulConnectionConfig,
): ContaAzulProductPayload {
  if (payload.kind !== "product") {
    throw new Error(
      "mapCatalogItemToContaAzulProduct aceita apenas itens do tipo produto",
    );
  }

  const nome = optionalTrimmed(payload.name);
  if (!nome) {
    throw new Error("Nome do produto é obrigatório para Conta Azul");
  }

  const sku =
    optionalTrimmed(payload.code)?.slice(0, 20) ??
    hashStableCode(payload.externalId).slice(0, 20);
  const description = optionalTrimmed(payload.description);
  const categoryId = optionalTrimmed(
    payload.categoryId ?? config.defaultProductCategoryId,
  );
  const unitOfMeasureId = optionalTrimmed(
    payload.unitOfMeasureId ?? config.defaultUnitOfMeasureId,
  );
  const fiscalMetadata = Object.assign(
    {},
    config.defaultFiscalTaxonomy,
    payload.fiscalMetadata,
  );
  const fiscalUnitOfMeasureId =
    optionalMetadataId(fiscalMetadata, "fiscalUnitOfMeasureId") ??
    optionalMetadataId(fiscalMetadata, "unitOfMeasureId") ??
    unitOfMeasureId;
  const ncmId = optionalMetadataId(fiscalMetadata, "ncmId");
  const cestId = optionalMetadataId(fiscalMetadata, "cestId");
  const origem = optionalMetadataText(fiscalMetadata, "origem");
  const tipoProduto = optionalMetadataText(fiscalMetadata, "tipoProduto");
  const price =
    typeof payload.priceCents === "number"
      ? centsToNonNegativeDecimal(payload.priceCents, "Preço do produto")
      : null;

  const mapped: ContaAzulProductPayload = {
    ativo: payload.active,
    codigo_sku: sku,
    formato: "SIMPLES",
    nome,
    status: payload.active ? "ATIVO" : "INATIVO",
  };

  if (description) mapped.descricao = description;
  if (categoryId) mapped.categoria = { id: categoryId };
  if (unitOfMeasureId) mapped.unidade_medida = { id: unitOfMeasureId };
  if (config.defaultCostCenterId) {
    mapped.id_centro_custo = config.defaultCostCenterId;
  }
  if (price !== null) {
    mapped.estoque = {
      valor_venda: price,
    };
  }

  const fiscal: NonNullable<ContaAzulProductPayload["fiscal"]> = {};
  if (ncmId !== null) fiscal.ncm = { id: ncmId };
  if (cestId !== null) fiscal.cest = { id: cestId };
  if (origem) fiscal.origem = origem;
  if (tipoProduto) fiscal.tipo_produto = tipoProduto;
  if (fiscalUnitOfMeasureId !== null) {
    fiscal.unidade_medida = { id: fiscalUnitOfMeasureId };
  }
  if (Object.keys(fiscal).length > 0) {
    mapped.fiscal = fiscal;
  }

  return mapped;
}

export function mapSaleToContaAzulSale(
  payload: IntegrationSalePayload,
  config: ContaAzulConnectionConfig,
  remoteCustomerId: string,
  saleNumber: number,
): ContaAzulSalePayload {
  const idCliente = optionalTrimmed(remoteCustomerId);
  if (!idCliente) {
    throw new Error("Cliente remoto da Conta Azul é obrigatório");
  }

  if (!Number.isInteger(saleNumber) || saleNumber <= 0) {
    throw new Error("Número da venda da Conta Azul deve ser inteiro positivo");
  }

  const dataVenda = toDateOnly(payload.saleDate, "Data da venda");
  const categoria = optionalTrimmed(
    payload.categoryId ?? config.defaultCategoryId,
  );
  const centroCusto = optionalTrimmed(
    payload.costCenterId ?? config.defaultCostCenterId,
  );
  const vendedor = optionalTrimmed(
    payload.sellerExternalId ?? config.defaultSellerId,
  );
  const observacoes = buildSaleNote(payload);

  const mapped: ContaAzulSalePayload = {
    id_cliente: idCliente,
    numero: saleNumber,
    situacao: mapSaleStatus(payload.status),
    data_venda: dataVenda,
    itens: mapCommercialItems(payload.items, "Venda"),
    condicao_pagamento: mapSalePaymentCondition(
      payload.paymentTerms,
      config,
      payload.totalCents,
      dataVenda,
    ),
  };

  if (categoria) mapped.id_categoria = categoria;
  if (centroCusto) mapped.id_centro_custo = centroCusto;
  if (vendedor) mapped.id_vendedor = vendedor;
  if (observacoes) mapped.observacoes = observacoes;

  return mapped;
}

export function mapContractToContaAzulContract(
  payload: IntegrationContractPayload,
  config: ContaAzulConnectionConfig,
  remoteCustomerId: string,
  contractNumber: number,
): ContaAzulContractPayload {
  const idCliente = optionalTrimmed(remoteCustomerId);
  if (!idCliente) {
    throw new Error("Cliente remoto da Conta Azul é obrigatório");
  }

  if (!Number.isInteger(contractNumber) || contractNumber <= 0) {
    throw new Error(
      "Número do contrato da Conta Azul deve ser inteiro positivo",
    );
  }

  const dataInicio = toDateOnly(payload.startsAt, "Data inicial do contrato");
  // Conta Azul requires data_fim on the recurrence even for tipo_expiracao
  // NUNCA (verified against the live API), so the contract end date is
  // mandatory and the expiration is always DATA.
  const dataFim = toDateOnly(payload.endsAt, "Data final do contrato");
  const categoria = optionalTrimmed(
    payload.categoryId ?? config.defaultCategoryId,
  );
  const centroCusto = optionalTrimmed(
    payload.costCenterId ?? config.defaultCostCenterId,
  );
  const vendedor = optionalTrimmed(
    payload.sellerExternalId ?? config.defaultSellerId,
  );
  const observacoes = buildContractNote(payload);

  const mapped: ContaAzulContractPayload = {
    id_cliente: idCliente,
    termos: {
      tipo_frequencia: mapContractFrequency(payload.recurrence),
      tipo_expiracao: "DATA",
      data_inicio: dataInicio,
      data_fim: dataFim,
      intervalo_frequencia: 1,
      dia_emissao_venda: Number(dataInicio.slice(8, 10)),
      numero: contractNumber,
    },
    condicao_pagamento: mapContractPaymentCondition(
      payload.paymentTerms,
      config,
    ),
    itens: mapCommercialItems(payload.items, "Contrato"),
  };

  const dataEmissao = optionalTrimmed(payload.issueDate);
  if (dataEmissao) {
    mapped.data_emissao = toDateOnly(
      dataEmissao,
      "Data de emissão do contrato",
    );
  }
  if (categoria) mapped.id_categoria = categoria;
  if (centroCusto) mapped.id_centro_custo = centroCusto;
  if (vendedor) mapped.id_vendedor = vendedor;
  if (observacoes) mapped.observacoes = observacoes;

  return mapped;
}

export function mapContaAzulProductInvoiceToFiscalMetadata(
  invoice: ContaAzulProductInvoice,
): IntegrationFiscalDocumentMetadata {
  return {
    fiscalDocumentType: "nfe",
    remoteEntityId: null,
    accessKey: optionalTrimmed(invoice.chave_acesso),
    number: numberOrTextToString(invoice.numero_nota),
    status: optionalTrimmed(invoice.status),
    issuedAt: optionalTrimmed(invoice.data_emissao),
    customerName: optionalTrimmed(invoice.nome_destinatario),
    customerDocument: null,
    saleRemoteId: null,
    contractRemoteId: null,
    saleNumber: null,
    totalAmountCents: null,
    xmlAvailable: Boolean(optionalTrimmed(invoice.chave_acesso)),
    consultationOnly: true,
    rawMetadata: {
      chave_acesso: optionalTrimmed(invoice.chave_acesso),
      numero_nota: numberOrTextToString(invoice.numero_nota),
      status: optionalTrimmed(invoice.status),
      data_emissao: optionalTrimmed(invoice.data_emissao),
      nome_destinatario: optionalTrimmed(invoice.nome_destinatario),
    },
  };
}

export function mapContaAzulServiceInvoiceToFiscalMetadata(
  invoice: ContaAzulServiceInvoice,
): IntegrationFiscalDocumentMetadata {
  return {
    fiscalDocumentType: "nfse",
    remoteEntityId: optionalTrimmed(invoice.id),
    accessKey: null,
    number: numberOrTextToString(invoice.numero_nfse),
    status: optionalTrimmed(invoice.status),
    issuedAt:
      optionalTrimmed(invoice.informacao_transmissao?.data_inicio_emissao) ??
      optionalTrimmed(invoice.data_competencia),
    customerName: optionalTrimmed(invoice.nome_cliente),
    customerDocument: onlyDigits(invoice.documento_cliente) || null,
    saleRemoteId: optionalTrimmed(invoice.id_venda),
    contractRemoteId: optionalTrimmed(invoice.id_contrato),
    saleNumber: numberOrTextToString(invoice.numero_venda),
    totalAmountCents: decimalToNullableCents(invoice.valor_total_nfse),
    xmlAvailable: false,
    consultationOnly: true,
    rawMetadata: {
      id: optionalTrimmed(invoice.id),
      id_venda: optionalTrimmed(invoice.id_venda),
      id_contrato: optionalTrimmed(invoice.id_contrato),
      numero_nfse: numberOrTextToString(invoice.numero_nfse),
      numero_rps: numberOrTextToString(invoice.numero_rps),
      numero_venda: numberOrTextToString(invoice.numero_venda),
      status: optionalTrimmed(invoice.status),
      data_competencia: optionalTrimmed(invoice.data_competencia),
      data_inicio_emissao: optionalTrimmed(
        invoice.informacao_transmissao?.data_inicio_emissao,
      ),
      data_inicio_cancelamento: optionalTrimmed(
        invoice.informacao_transmissao?.data_inicio_cancelamento,
      ),
      documento_cliente: onlyDigits(invoice.documento_cliente) || null,
      nome_cliente: optionalTrimmed(invoice.nome_cliente),
      valor_total_nfse: invoice.valor_total_nfse ?? null,
      cidade_emissao: invoice.cidade_emissao
        ? {
            estado: optionalTrimmed(invoice.cidade_emissao.estado),
            nome: optionalTrimmed(invoice.cidade_emissao.nome),
          }
        : null,
      cancelamento: invoice.informacoes_cancelamento
        ? {
            motivo: optionalTrimmed(invoice.informacoes_cancelamento.motivo),
            usuario: optionalTrimmed(invoice.informacoes_cancelamento.usuario),
          }
        : null,
    },
  };
}

export function mapMdfeLinkToContaAzulPayload(
  payload: IntegrationMdfeLinkPayload,
): ContaAzulMdfeLinkPayload {
  const chavesAcesso = payload.fiscalDocumentAccessKeys
    .map((key) => onlyDigits(key))
    .filter((key) => key.length > 0);
  if (chavesAcesso.length === 0) {
    throw new Error("Informe ao menos uma chave de acesso fiscal para o MDF-e");
  }

  const invalidKey = chavesAcesso.find((key) => key.length !== 44);
  if (invalidKey) {
    throw new Error("Chave de acesso fiscal para MDF-e deve ter 44 dígitos");
  }

  const identificador = optionalTrimmed(payload.mdfeIdentifier);
  if (!identificador) {
    throw new Error("Identificador do MDF-e é obrigatório");
  }

  const mapped: ContaAzulMdfeLinkPayload = {
    chaves_acesso: [...new Set(chavesAcesso)],
    identificador,
  };

  if (payload.status) {
    const status: ContaAzulMdfeLinkStatus = payload.status;
    mapped.status = status;
  }

  return mapped;
}

export function mapBillingDocumentToReceivableEvent(
  payload: IntegrationBillingDocumentPayload,
  config: ContaAzulConnectionConfig,
  remoteCustomerId: string,
): ContaAzulReceivableEventCreate {
  const contato = optionalTrimmed(remoteCustomerId);
  if (!contato) {
    throw new Error("Cliente remoto da Conta Azul é obrigatório");
  }

  const contaFinanceira = optionalTrimmed(config.defaultFinancialAccountId);
  if (!contaFinanceira) {
    throw new Error("Conta financeira padrão da Conta Azul não configurada");
  }

  const dataCompetencia = toDateOnly(payload.issueDate, "Data de competência");
  const dataVencimento = toDateOnly(payload.dueDate, "Data de vencimento");
  const valor = centsToDecimal(payload.totalCents, "Valor da fatura");
  const descricao = buildBillingDescription(payload);
  const nota = buildBillingNote(payload);
  // Conta Azul requires the rateio to carry at least one financial category,
  // so a default category is mandatory to export financial documents.
  const categoria = optionalTrimmed(config.defaultCategoryId);
  if (!categoria) {
    throw new Error(
      "Configure uma categoria financeira padrão da Conta Azul antes de exportar documentos financeiros.",
    );
  }
  const centroCusto = optionalTrimmed(config.defaultCostCenterId);

  const mapped: ContaAzulReceivableEventCreate = {
    data_competencia: dataCompetencia,
    valor,
    observacao: nota,
    descricao,
    contato,
    conta_financeira: contaFinanceira,
    condicao_pagamento: {
      parcelas: [
        {
          descricao,
          data_vencimento: dataVencimento,
          nota,
          conta_financeira: contaFinanceira,
          detalhe_valor: {
            valor_bruto: valor,
            valor_liquido: valor,
          },
        },
      ],
    },
  };

  mapped.rateio = [
    {
      id_categoria: categoria,
      valor,
      ...(centroCusto
        ? {
            rateio_centro_custo: [
              {
                id_centro_custo: centroCusto,
                valor,
              },
            ],
          }
        : {}),
    },
  ];

  return mapped;
}

export function mapPayableToContaAzulPayableEvent(
  payload: IntegrationPayablePayload,
  config: ContaAzulConnectionConfig,
  remoteSupplierId: string,
): ContaAzulPayableEventCreate {
  const contato = optionalTrimmed(remoteSupplierId);
  if (!contato) {
    throw new Error("Fornecedor remoto da Conta Azul é obrigatório");
  }

  const contaFinanceira = optionalTrimmed(config.defaultFinancialAccountId);
  if (!contaFinanceira) {
    throw new Error("Conta financeira padrão da Conta Azul não configurada");
  }

  const dataCompetencia = toDateOnly(
    payload.competenceDate ?? payload.issueDate,
    "Data de competência da conta a pagar",
  );
  const dataVencimento = toDateOnly(
    payload.dueDate,
    "Data de vencimento da conta a pagar",
  );
  const valor = centsToDecimal(payload.amountCents, "Valor da conta a pagar");
  const descricao = buildPayableDescription(payload);
  const nota = buildPayableNote(payload);
  // Conta Azul requires the rateio to carry at least one financial category.
  const categoria = optionalTrimmed(
    payload.categoryId ?? config.defaultExpenseCategoryId,
  );
  if (!categoria) {
    throw new Error(
      "Configure uma categoria de despesa padrão da Conta Azul antes de exportar contas a pagar.",
    );
  }
  const centroCusto = optionalTrimmed(
    payload.costCenterId ?? config.defaultCostCenterId,
  );

  const mapped: ContaAzulPayableEventCreate = {
    data_competencia: dataCompetencia,
    valor,
    observacao: nota,
    descricao,
    contato,
    conta_financeira: contaFinanceira,
    condicao_pagamento: {
      parcelas: [
        {
          descricao,
          data_vencimento: dataVencimento,
          nota,
          conta_financeira: contaFinanceira,
          detalhe_valor: {
            valor_bruto: valor,
            valor_liquido: valor,
          },
        },
      ],
    },
  };

  mapped.rateio = [
    {
      id_categoria: categoria,
      valor,
      ...(centroCusto
        ? {
            rateio_centro_custo: [
              {
                id_centro_custo: centroCusto,
                valor,
              },
            ],
          }
        : {}),
    },
  ];

  return mapped;
}

export function mapContaAzulInstallmentStatus(
  installment: ContaAzulInstallment,
): ContaAzulInstallmentStatusMapping {
  const status = installment.status;
  const paidAmount =
    typeof installment.valor_pago === "number" ? installment.valor_pago : null;
  const dueDate = optionalTrimmed(installment.data_vencimento);

  switch (status) {
    case "RECEBIDO":
    case "QUITADO":
      return {
        billingDocumentStatus: "PAID",
        installmentStatus: "PAID",
        paidAmount,
        dueDate,
        requiresReview: false,
      };
    case "ATRASADO":
      return {
        billingDocumentStatus: "OVERDUE",
        installmentStatus: "OVERDUE",
        paidAmount,
        dueDate,
        requiresReview: false,
      };
    case "CANCELADO":
    case "PERDIDO":
      return {
        billingDocumentStatus: "VOID",
        installmentStatus: "VOID",
        paidAmount,
        dueDate,
        requiresReview: false,
      };
    case "RECEBIDO_PARCIAL":
      return {
        billingDocumentStatus: "ISSUED",
        installmentStatus: "OPEN",
        paidAmount,
        dueDate,
        requiresReview: false,
      };
    case "RENEGOCIADO":
      return {
        billingDocumentStatus: "ISSUED",
        installmentStatus: "OPEN",
        paidAmount,
        dueDate,
        requiresReview: true,
      };
    case "EM_ABERTO":
    case "PENDENTE":
      return {
        billingDocumentStatus: "ISSUED",
        installmentStatus: "OPEN",
        paidAmount,
        dueDate,
        requiresReview: false,
      };
    default:
      return {
        billingDocumentStatus: "ISSUED",
        installmentStatus: "OPEN",
        paidAmount,
        dueDate,
        requiresReview: true,
      };
  }
}
