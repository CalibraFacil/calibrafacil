import {
  applyIntegrationMappings,
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
  validateIntegrationMappings,
} from "@calibra-facil/shared";
import { normalizeCnpj } from "@calibra-facil/shared/cnpj";
import type {
  ContaAzulConnectionConfig,
  ContaAzulReferenceDomain,
  ContaAzulReferenceItem,
  ContaAzulReferencePage,
  FinancialErpAdapter,
  FinancialErpConnectionConfig,
  GenericFinancialErpConnectionConfig,
  IntegrationBillingDocumentPayload,
  IntegrationBudgetPayload,
  IntegrationCatalogItemPayload,
  IntegrationCommercialItemPayload,
  IntegrationContractPayload,
  IntegrationCustomerPayload,
  IntegrationMdfeLinkPayload,
  IntegrationObjectLinkTarget,
  IntegrationPayablePayload,
  IntegrationPessoaPayload,
  IntegrationProvider,
  IntegrationSalePayload,
  IntegrationSupplierPayload,
  IntegrationSyncCursor,
  IntegrationSyncTarget,
  IntegrationTransporterPayload,
  IntegrationValidationResult,
  RemoteEntityRef,
  RemoteStatusPollResult,
} from "@calibra-facil/shared";
import {
  ContaAzulApiError,
  ContaAzulClient,
  clampContaAzulPageSize,
  type ContaAzulInstallment,
  type ContaAzulPessoaPayload,
  type ContaAzulPessoaPerfil,
  type ContaAzulPayableSearchResponse,
  type ContaAzulPessoaSearchItem,
  type ContaAzulPessoaSearchResponse,
  type ContaAzulProductPayload,
  type ContaAzulProductSearchItem,
  type ContaAzulProductSearchResponse,
  type ContaAzulProtocolStatusResponse,
  type ContaAzulProductInvoice,
  type ContaAzulProductInvoiceSearchResponse,
  type ContaAzulServiceInvoice,
  type ContaAzulServiceInvoiceSearchResponse,
  type ContaAzulServicoPayload,
  type ContaAzulServicoSearchItem,
  type ContaAzulServicoSearchResponse,
} from "./conta-azul-client";
import {
  mapBillingDocumentToReceivableEvent,
  mapContaAzulProductInvoiceToFiscalMetadata,
  mapContaAzulServiceInvoiceToFiscalMetadata,
  extractContaAzulProductStockQuantity,
  mapCatalogItemToContaAzulProduct,
  mapCatalogItemToContaAzulServico,
  mapContractToContaAzulContract,
  mapCustomerToContaAzulPessoa,
  mapMdfeLinkToContaAzulPayload,
  mapPayableToContaAzulPayableEvent,
  mapPessoaToContaAzulPessoa,
  mapSaleToContaAzulSale,
} from "./conta-azul-mappers";

type SyncPayload =
  | IntegrationCustomerPayload
  | IntegrationBillingDocumentPayload;

type RemoteJsonResult = {
  ok: boolean;
  status: number;
  data: unknown;
};

type AdapterLinks = {
  getExistingRemoteId(params: {
    target: IntegrationObjectLinkTarget;
    localEntityId: string;
  }): Promise<string | null>;
  listLinks?(params: {
    targets: IntegrationObjectLinkTarget[];
    limit: number;
    offset: number;
  }): Promise<
    Array<{
      target: IntegrationObjectLinkTarget;
      localEntityId: string;
      remoteEntityId: string | null;
      remoteDisplayId?: string | null;
      remoteEntityType?: string | null;
      metadata?: Record<string, unknown> | null;
    }>
  >;
  upsertLink(params: {
    target: IntegrationObjectLinkTarget;
    localEntityId: string;
    remoteEntityId: string | null;
    remoteDisplayId?: string | null;
    remoteEntityType?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
};

type GenericHttpAdapterOptions = {
  integrationId: string;
  organizationId: string;
  config: GenericFinancialErpConnectionConfig;
  secret: string;
  fetchImpl?: typeof fetch;
  links?: AdapterLinks;
};

type ContaAzulAdapterOptions = {
  integrationId: string;
  organizationId: string;
  config: ContaAzulConnectionConfig;
  accessToken: string;
  fetchImpl?: typeof fetch;
  links?: AdapterLinks;
  minRequestIntervalMs?: number;
  rateLimitKey?: string | null;
  onUnauthorized?: () => Promise<string | null>;
};

type FiscalDocumentPollType = "nfe" | "nfse";

const CONTA_AZUL_FISCAL_CURSOR_TYPE = "conta_azul_fiscal_documents";
const FISCAL_POLL_WINDOW_DAYS = 15;
const PAYABLE_POLL_LOOKBACK_DAYS = 30;
const PAYABLE_POLL_DUE_LOOKBACK_DAYS = 365;
const PAYABLE_POLL_DUE_LOOKAHEAD_DAYS = 365;
const CONTA_AZUL_MIN_SEARCH_PAGE_SIZE = 10;
const CONTA_AZUL_BUDGET_SALE_SITUATIONS = [
  "ORCAMENTO",
  "ORCAMENTO_ACEITO",
  "ORCAMENTO_RECUSADO",
] as const;

function isContaAzulBudgetSaleSituation(
  value: string,
): value is (typeof CONTA_AZUL_BUDGET_SALE_SITUATIONS)[number] {
  return CONTA_AZUL_BUDGET_SALE_SITUATIONS.some(
    (situation) => situation === value,
  );
}

export type FinancialErpAdapterOptions =
  | ({
      provider: "generic_http";
    } & Omit<GenericHttpAdapterOptions, "config"> & {
        config: GenericFinancialErpConnectionConfig;
      })
  | ({
      provider: "conta_azul";
    } & ContaAzulAdapterOptions);

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

async function callRemoteJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<RemoteJsonResult> {
  const response = await fetchImpl(url, init);
  const contentType = response.headers.get("content-type") ?? "";

  let data: unknown = null;
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function extractRemoteId(data: unknown): string | null {
  const record = toRecord(data);
  if (typeof record.remoteId === "string" && record.remoteId.trim()) {
    return record.remoteId;
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id;
  }
  if (typeof record.id === "number") {
    return String(record.id);
  }

  return null;
}

function extractContaAzulRemoteId(data: unknown): string {
  const remoteId = extractRemoteId(data);
  if (!remoteId) {
    throw new Error("Resposta da Conta Azul não retornou id remoto");
  }

  return remoteId;
}

function extractContaAzulProtocolId(data: unknown): string {
  const record = toRecord(data);
  // The live API returns the protocol id as `protocolo` (Portuguese). Older
  // assumptions/mocks used `protocolId`; accept both before falling back.
  if (typeof record.protocolo === "string" && record.protocolo.trim()) {
    return record.protocolo;
  }
  if (typeof record.protocolId === "string" && record.protocolId.trim()) {
    return record.protocolId;
  }

  return extractContaAzulRemoteId(data);
}

function extractContaAzulGeneratedSaleId(data: unknown): string | null {
  const record = toRecord(data);
  return (
    optionalText(record.id_venda) ??
    optionalText(record.saleId) ??
    optionalText(toRecord(record.venda).id)
  );
}

function extractContaAzulSaleNumber(data: unknown): number | null {
  if (typeof data === "number" && Number.isInteger(data)) {
    return data;
  }
  if (typeof data === "string" && /^\d+$/.test(data.trim())) {
    return Number(data.trim());
  }

  const record = toRecord(data);
  const candidates = [
    record.numero,
    toRecord(record.venda).numero,
    toRecord(record.negociacao).numero,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) {
      return Number(candidate.trim());
    }
  }

  return null;
}

function extractContaAzulSituationName(data: unknown) {
  const record = toRecord(data);
  return (
    optionalText(record.situacao) ??
    optionalText(toRecord(record.situacao).nome) ??
    optionalText(record.status)
  );
}

function extractContaAzulSaleCustomerId(data: unknown) {
  const record = toRecord(data);
  const customer = toRecord(record.cliente);
  return (
    optionalText(record.id_cliente) ??
    optionalText(customer.id) ??
    optionalText(customer.uuid)
  );
}

function parseSaleNumber(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: string | null | undefined) {
  return parseSaleNumber(value);
}

function buildBillingDocumentSaleNotes(
  payload: IntegrationBillingDocumentPayload,
) {
  return [
    payload.documentNumber
      ? `Documento financeiro ${payload.documentNumber}`
      : null,
    payload.unitName ? `Unidade: ${payload.unitName}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function mapBillingDocumentToSalePayload(
  payload: IntegrationBillingDocumentPayload,
): IntegrationSalePayload {
  return {
    externalId: payload.externalId,
    organizationId: payload.organizationId,
    customerExternalId: payload.customerExternalId,
    saleNumber: payload.documentNumber,
    saleDate: payload.issueDate,
    status: payload.status,
    sellerExternalId: null,
    categoryId: null,
    costCenterId: null,
    totalCents: payload.totalCents,
    currency: payload.currency,
    notes: buildBillingDocumentSaleNotes(payload),
    items: payload.items.map((item) => ({
      lineId: item.lineId,
      catalogItemExternalId: item.catalogItemExternalId ?? null,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents,
    })),
    paymentTerms: {
      paymentMethodId: null,
      financialAccountId: null,
      paymentConditionLabel: "À vista",
      dueDate: payload.dueDate ?? payload.issueDate,
      installments: [
        {
          dueDate: payload.dueDate ?? payload.issueDate ?? "",
          amountCents: payload.totalCents,
          description: payload.documentNumber
            ? `Documento ${payload.documentNumber}`
            : "Documento financeiro",
        },
      ],
    },
  };
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function minDate(first: Date, second: Date) {
  return first.getTime() <= second.getTime() ? first : second;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

// Default lookback window for reference catalogs that require a date range
// (e.g. financial transfers), used only to populate settings-page previews.
const REFERENCE_WINDOW_DAYS = 90;

function referenceWindowEndDate() {
  return toDateOnly(new Date());
}

function referenceWindowStartDate() {
  return toDateOnly(new Date(Date.now() - REFERENCE_WINDOW_DAYS * 86_400_000));
}

function getServiceInvoiceDriftDate(
  metadata: Record<string, unknown> | null | undefined,
) {
  const fiscal = toRecord(toRecord(metadata).fiscal);
  const rawMetadata = toRecord(fiscal.rawMetadata);
  const explicitDate =
    optionalText(rawMetadata.data_competencia) ??
    optionalText(fiscal.issuedAt) ??
    optionalText(rawMetadata.data_inicio_emissao);
  if (!explicitDate) {
    return null;
  }

  const parsed = parseDate(explicitDate);
  return parsed ? toDateOnly(parsed) : explicitDate.slice(0, 10);
}

function getContractDriftWindow(
  metadata: Record<string, unknown> | null | undefined,
) {
  const record = toRecord(metadata);
  const startText =
    optionalText(record.startsAt) ?? optionalText(record.startDate);
  if (!startText) {
    return null;
  }

  const start = parseDate(startText);
  if (!start) {
    return null;
  }

  const endText = optionalText(record.endsAt) ?? optionalText(record.endDate);
  const parsedEnd = parseDate(endText);
  const end = parsedEnd ?? addDays(start, 366);

  return {
    start: toDateOnly(start),
    end: toDateOnly(end),
  };
}

function toContaAzulDateTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

function getCursorStateText(cursor: IntegrationSyncCursor, key: string) {
  const value = toRecord(cursor.state)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getCursorStateNumber(
  cursor: IntegrationSyncCursor,
  key: string,
  fallback: number,
) {
  const value = toRecord(cursor.state)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getCursorFiscalPollType(
  cursor: IntegrationSyncCursor,
): FiscalDocumentPollType {
  return getCursorStateText(cursor, "documentType") === "nfse" ? "nfse" : "nfe";
}

function getFiscalWindow(cursor: IntegrationSyncCursor) {
  const now = new Date();
  const start =
    parseDate(cursor.lastRemoteUpdatedAt) ??
    new Date(now.getTime() - FISCAL_POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const storedWindowEnd = parseDate(getCursorStateText(cursor, "windowEndAt"));
  const end =
    storedWindowEnd ?? minDate(now, addDays(start, FISCAL_POLL_WINDOW_DAYS));

  return { start, end };
}

function getPayablePollWindow(cursor: IntegrationSyncCursor) {
  const now = new Date();
  const start =
    parseDate(cursor.lastRemoteUpdatedAt) ??
    new Date(now.getTime() - PAYABLE_POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const storedWindowEnd = parseDate(getCursorStateText(cursor, "windowEndAt"));
  const dueDateFrom =
    parseDate(getCursorStateText(cursor, "dueDateFrom")) ??
    new Date(
      now.getTime() - PAYABLE_POLL_DUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
  const dueDateTo =
    parseDate(getCursorStateText(cursor, "dueDateTo")) ??
    new Date(
      now.getTime() + PAYABLE_POLL_DUE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
    );

  return {
    start,
    end: storedWindowEnd ?? now,
    dueDateFrom,
    dueDateTo,
  };
}

function extractProductInvoices(
  response: ContaAzulProductInvoiceSearchResponse,
) {
  return response.itens ?? [];
}

function extractServiceInvoices(
  response: ContaAzulServiceInvoiceSearchResponse,
) {
  return response.itens ?? [];
}

function extractPayableItems(response: ContaAzulPayableSearchResponse) {
  return response.items ?? response.itens ?? [];
}

function extractPayableTotalItems(response: ContaAzulPayableSearchResponse) {
  const totalItems = response.totalItems ?? response.itens_totais;
  return typeof totalItems === "number" && Number.isFinite(totalItems)
    ? totalItems
    : null;
}

function hasNextFiscalPage(params: {
  page: number;
  pageSize: number;
  totalItems: number | null;
  pageItemCount: number;
}) {
  if (params.pageItemCount < params.pageSize) return false;
  if (params.totalItems === null) return true;
  return params.page * params.pageSize < params.totalItems;
}

function extractFiscalTotalItems(
  response:
    | ContaAzulProductInvoiceSearchResponse
    | ContaAzulServiceInvoiceSearchResponse,
) {
  const totalItems = response.paginacao?.total_itens;
  return typeof totalItems === "number" && Number.isFinite(totalItems)
    ? totalItems
    : null;
}

function getProductInvoiceLinkId(
  invoice: ContaAzulProductInvoice,
  index: number,
) {
  const metadata = mapContaAzulProductInvoiceToFiscalMetadata(invoice);
  return metadata.accessKey ?? metadata.number ?? `nfe:${index + 1}`;
}

function getServiceInvoiceLinkId(
  invoice: ContaAzulServiceInvoice,
  index: number,
) {
  const metadata = mapContaAzulServiceInvoiceToFiscalMetadata(invoice);
  return metadata.remoteEntityId ?? metadata.number ?? `nfse:${index + 1}`;
}

function extractPayableExternalId(installment: ContaAzulInstallment) {
  const candidates = [
    installment.nota,
    installment.descricao,
    installment.evento?.referencia,
  ];

  for (const candidate of candidates) {
    const match = candidate?.match(/payable:[^\s;,]+/i);
    if (match?.[0]) return match[0];
  }

  return null;
}

function getPayableStatus(installment: ContaAzulInstallment) {
  return installment.status_traduzido ?? installment.status;
}

function getPayablePaidAmount(installment: ContaAzulInstallment) {
  if (typeof installment.valor_pago === "number") return installment.valor_pago;
  if (typeof installment.pago === "number") return installment.pago;
  return null;
}

function buildPayableInstallmentMetadata(params: {
  installment: ContaAzulInstallment;
  payableExternalId: string | null;
  acquittanceCount: number;
}) {
  return {
    provider: "conta_azul",
    resource: "financeiro/eventos-financeiros/contas-a-pagar/buscar",
    source: "payable_poll",
    status: getPayableStatus(params.installment),
    dueDate: params.installment.data_vencimento ?? null,
    changedAt: params.installment.data_alteracao ?? null,
    paidAmount: getPayablePaidAmount(params.installment),
    openAmount: params.installment.nao_pago ?? null,
    totalAmount: params.installment.total ?? null,
    acquittanceCount: params.acquittanceCount,
    ...(typeof params.installment.indice === "number"
      ? { installmentIndex: params.installment.indice }
      : {}),
    ...(params.installment.evento?.id
      ? { eventId: params.installment.evento.id }
      : {}),
    ...(params.payableExternalId
      ? { payableExternalId: params.payableExternalId }
      : {}),
  };
}

function extractAcquittanceItems(response: unknown) {
  if (Array.isArray(response)) return response;
  const record = toRecord(response);
  const items = record.items ?? record.itens;
  return Array.isArray(items) ? items : [];
}

function getAcquittanceId(acquittance: unknown) {
  const record = toRecord(acquittance);
  const id = record.id ?? record.baixa_id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

function extractPessoaItems(response: ContaAzulPessoaSearchResponse) {
  return response.items ?? response.itens ?? [];
}

function getPessoaItemId(item: ContaAzulPessoaSearchItem) {
  return typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
}

// normalizeCnpj preserves alphanumeric CNPJ chars; both sides of the equality match below must
// use it so person dedup keeps working for alphanumeric CNPJs (CPFs are unaffected — numeric).
function getPessoaDocument(item: ContaAzulPessoaSearchItem) {
  return normalizeCnpj(item.documento ?? item.cpf ?? item.cnpj);
}

function getPayloadDocument(payload: ContaAzulPessoaPayload) {
  return normalizeCnpj(payload.cpf ?? payload.cnpj);
}

function getProductSku(payload: ContaAzulProductPayload) {
  return payload.codigo_sku?.trim() ?? "";
}

function selectPessoaByDocument(
  response: ContaAzulPessoaSearchResponse,
  document: string,
) {
  const candidates = extractPessoaItems(response).filter((item) =>
    Boolean(getPessoaItemId(item)),
  );
  const exactMatch = candidates.find(
    (item) => getPessoaDocument(item) === document,
  );

  if (exactMatch) {
    return getPessoaItemId(exactMatch);
  }

  if (candidates.length === 1) {
    const [candidate] = candidates;
    return candidate ? getPessoaItemId(candidate) : null;
  }

  return null;
}

function extractProductItems(response: ContaAzulProductSearchResponse) {
  return response.items ?? response.itens ?? [];
}

function getProductItemId(item: ContaAzulProductSearchItem) {
  return typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
}

function getProductItemSku(item: ContaAzulProductSearchItem) {
  const sku = item.codigo_sku ?? item.codigo;
  return typeof sku === "string" ? sku.trim() : "";
}

function extractServicoItems(response: ContaAzulServicoSearchResponse) {
  return response.items ?? response.itens ?? [];
}

function getServicoItemId(item: ContaAzulServicoSearchItem) {
  return typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
}

function getServicoItemCodigo(item: ContaAzulServicoSearchItem) {
  const codigo = item.codigo;
  return typeof codigo === "string" ? codigo.trim() : "";
}

function selectServicoByCodigo(
  response: ContaAzulServicoSearchResponse,
  codigo: string,
) {
  const candidates = extractServicoItems(response).filter((item) =>
    Boolean(getServicoItemId(item)),
  );
  const exactMatch = candidates.find(
    (item) => getServicoItemCodigo(item) === codigo,
  );
  if (exactMatch) {
    return getServicoItemId(exactMatch);
  }
  if (candidates.length === 1) {
    const [candidate] = candidates;
    return candidate ? getServicoItemId(candidate) : null;
  }
  return null;
}

function selectProductBySku(
  response: ContaAzulProductSearchResponse,
  sku: string,
) {
  const candidates = extractProductItems(response).filter((item) =>
    Boolean(getProductItemId(item)),
  );
  const exactMatch = candidates.find((item) => getProductItemSku(item) === sku);

  if (exactMatch) {
    return getProductItemId(exactMatch);
  }

  if (candidates.length === 1) {
    const [candidate] = candidates;
    return candidate ? getProductItemId(candidate) : null;
  }

  return null;
}

function getPessoaProfile(
  payload: ContaAzulPessoaPayload,
): ContaAzulPessoaPerfil {
  return payload.perfis?.[0]?.tipo_perfil ?? "Cliente";
}

function getPessoaLinkTarget(
  role: IntegrationPessoaPayload["pessoaRole"],
): IntegrationObjectLinkTarget {
  switch (role) {
    case "supplier":
      return "supplier";
    case "transporter":
      return "transporter";
    case "customer":
      return "customer";
  }
}

function getSafeErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Falha ao consultar documento";

  return message
    .replace(/(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(
      /(access_token|refresh_token|authorization|client_secret)=([^&\s]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 500);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }

  return null;
}

function optionalIdText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function summarizeFiscalAccessKeys(accessKeys: string[]) {
  return accessKeys.map((key) => ({
    lastDigits: key.slice(-6),
    length: key.length,
  }));
}

function extractContaAzulReferenceItems(response: unknown) {
  if (Array.isArray(response)) return response;
  const record = toRecord(response);
  const items = record.items ?? record.itens;
  return Array.isArray(items) ? items : [];
}

function normalizeContaAzulReferenceItem(
  item: unknown,
  fallbackId: string,
): ContaAzulReferenceItem {
  const record = toRecord(item);
  const id =
    optionalIdText(record.id) ??
    optionalText(record.codigo) ??
    optionalText(record.codigo_sku) ??
    optionalText(record.identificador) ??
    fallbackId;
  const name =
    optionalText(record.nome) ??
    optionalText(record.descricao) ??
    optionalText(record.numero) ??
    id;
  const status = optionalText(record.status);
  const financialAccount = toRecord(record.conta_financeira);
  const financialAccountId = optionalIdText(financialAccount.id);
  const financialAccountName = optionalText(financialAccount.nome);
  const sourceIndex = optionalNumber(record.sourceIndex);
  const error = optionalText(record.error);
  const externalId = optionalText(record.id_externo);

  return {
    id,
    name,
    code:
      optionalText(record.codigo) ??
      optionalText(record.codigo_sku) ??
      (typeof record.id_legado === "number" ? String(record.id_legado) : null),
    active:
      typeof record.ativo === "boolean"
        ? record.ativo
        : status === "ATIVO"
          ? true
          : status === "INATIVO"
            ? false
            : null,
    metadata: {
      type:
        optionalText(record.tipo) ??
        optionalText(record.tipo_servico) ??
        optionalText(record.tipo_perfil),
      status,
      bankCode: optionalNumber(record.codigo_banco),
      amount: optionalNumber(record.valor),
      date: optionalText(record.data),
      ...(externalId ? { externalId } : {}),
      legacyId:
        typeof record.id_legado === "string" ||
        typeof record.id_legado === "number"
          ? record.id_legado
          : null,
      ...(financialAccountId
        ? { financialAccountId, financialAccountName }
        : {}),
      ...(sourceIndex !== null ? { sourceIndex } : {}),
      ...(error ? { error } : {}),
    },
  };
}

function getReferenceDomainFromMetadata(value: unknown) {
  const domain = optionalText(value);
  switch (domain) {
    case "accounts":
    case "balances":
    case "categories":
    case "cest":
    case "costCenters":
    case "dreCategories":
    case "ncm":
    case "productCategories":
    case "productEcommerceBrands":
    case "productEcommerceCategories":
    case "products":
    case "sellers":
    case "serviceCategories":
    case "transfers":
    case "units":
      return domain;
    default:
      return null;
  }
}

function inferReferenceDomainFromRemoteEntityType(value: unknown) {
  switch (optionalText(value)) {
    case "conta_azul_financial_account":
      return "accounts";
    case "conta_azul_financial_account_balance":
      return "balances";
    case "conta_azul_financial_category":
      return "categories";
    case "conta_azul_cost_center":
      return "costCenters";
    case "conta_azul_dre_category":
      return "dreCategories";
    case "conta_azul_product_cest":
      return "cest";
    case "conta_azul_product_ncm":
      return "ncm";
    case "conta_azul_product_category":
      return "productCategories";
    case "conta_azul_product_ecommerce_brand":
      return "productEcommerceBrands";
    case "conta_azul_product_ecommerce_category":
      return "productEcommerceCategories";
    case "conta_azul_product_unit":
      return "units";
    case "conta_azul_seller":
      return "sellers";
    case "conta_azul_service":
      return "serviceCategories";
    case "conta_azul_financial_transfer":
      return "transfers";
    default:
      return null;
  }
}

function buildAuthHeaders(secret: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

function getGenericHttpTargetPath(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
) {
  switch (target) {
    case "customer":
      return config.customerPath;
    case "service_order":
      return config.serviceOrderPath;
    case "billing_document":
      return config.billingDocumentPath;
  }
}

function assertValidMappings(
  config: GenericFinancialErpConnectionConfig,
  target?: IntegrationSyncTarget,
) {
  const issues = validateIntegrationMappings(config.mappings).filter(
    (issue) => !target || issue.target === target,
  );

  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join(" "));
  }
}

function mapGenericPayload(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
  payload: SyncPayload,
) {
  const { mappedPayload, issues } = applyIntegrationMappings(
    target,
    toRecord(payload),
    config.mappings[target],
  );

  if (issues.length > 0) {
    throw new Error(`Payload inválido para ${target}: ${issues.join(" ")}`);
  }

  return mappedPayload;
}

export class GenericHttpFinancialErpAdapter implements FinancialErpAdapter {
  readonly provider = "generic_http" as const;
  private readonly config: GenericFinancialErpConnectionConfig;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly links: GenericHttpAdapterOptions["links"];

  constructor(options: GenericHttpAdapterOptions) {
    this.config = normalizeGenericFinancialErpConfig(options.config);
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.links = options.links;
  }

  async validateConnection(): Promise<IntegrationValidationResult> {
    const result = await callRemoteJson(
      this.fetchImpl,
      `${this.config.baseUrl}${this.config.healthPath}`,
      {
        method: "GET",
        headers: buildAuthHeaders(this.secret),
      },
    );

    if (!result.ok) {
      throw new Error(`Conector remoto respondeu ${result.status}`);
    }

    return {
      ok: true,
      provider: this.provider,
      status: "connected",
      message: null,
      details: {
        status: result.status,
      },
    };
  }

  async upsertCustomer(
    payload: IntegrationCustomerPayload,
  ): Promise<RemoteEntityRef> {
    return this.pushTargetRecord("customer", payload);
  }

  async exportBillingDocument(
    payload: IntegrationBillingDocumentPayload,
  ): Promise<RemoteEntityRef> {
    return this.pushTargetRecord("billing_document", payload);
  }

  private async pushTargetRecord(
    target: "customer" | "billing_document",
    payload: SyncPayload,
  ): Promise<RemoteEntityRef> {
    assertValidMappings(this.config, target);

    const mappedPayload = mapGenericPayload(this.config, target, payload);
    const existingRemoteId =
      (await this.links?.getExistingRemoteId({
        target,
        localEntityId: payload.externalId,
      })) ?? null;
    const targetPath = getGenericHttpTargetPath(this.config, target);
    const method = existingRemoteId ? "PUT" : "POST";
    const url = existingRemoteId
      ? `${this.config.baseUrl}${targetPath}/${encodeURIComponent(existingRemoteId)}`
      : `${this.config.baseUrl}${targetPath}`;

    const result = await callRemoteJson(this.fetchImpl, url, {
      method,
      headers: buildAuthHeaders(this.secret),
      body: JSON.stringify(mappedPayload),
    });

    if (!result.ok) {
      throw new Error(
        `Falha ao sincronizar ${target}: remoto respondeu ${result.status}`,
      );
    }

    const remoteEntityId = extractRemoteId(result.data) ?? existingRemoteId;
    await this.links?.upsertLink({
      target,
      localEntityId: payload.externalId,
      remoteEntityId,
      remoteDisplayId: remoteEntityId,
      remoteEntityType: target,
    });

    return {
      remoteEntityId,
      remoteDisplayId: remoteEntityId,
      remoteEntityType: target,
    };
  }
}

export class ContaAzulFinancialErpAdapter implements FinancialErpAdapter {
  readonly provider = "conta_azul" as const;
  private readonly config: ContaAzulConnectionConfig;
  private readonly client: ContaAzulClient;
  private readonly links: AdapterLinks | undefined;

  constructor(options: ContaAzulAdapterOptions) {
    this.config = normalizeContaAzulConnectionConfig(options.config);
    this.client = new ContaAzulClient({
      accessToken: options.accessToken,
      baseUrl: this.config.baseUrl,
      fetchImpl: options.fetchImpl,
      minRequestIntervalMs: options.minRequestIntervalMs,
      rateLimitKey: options.rateLimitKey ?? options.integrationId,
      onUnauthorized: options.onUnauthorized,
    });
    this.links = options.links;
  }

  async validateConnection(): Promise<IntegrationValidationResult> {
    await this.client.listFinancialAccounts({
      pagina: 1,
      tamanho_pagina: 10,
      apenas_ativo: true,
    });

    return {
      ok: true,
      provider: this.provider,
      status: "connected",
      message: null,
      details: {
        baseUrl: this.config.baseUrl,
      },
    };
  }

  async listReferenceData(
    domain: ContaAzulReferenceDomain,
  ): Promise<ContaAzulReferencePage> {
    const query = {
      pagina: 1,
      tamanho_pagina: 100,
    };
    try {
      const response = await (() => {
        switch (domain) {
          case "accounts":
            return this.client.listFinancialAccounts({
              ...query,
              apenas_ativo: true,
            });
          case "balances":
            return this.listFinancialAccountBalances();
          case "categories":
            return this.client.listCategories(query);
          case "costCenters":
            return this.client.listCostCenters({
              ...query,
              filtro_rapido: "ATIVO",
            });
          case "dreCategories":
            return this.client.listDreCategories();
          case "productCategories":
            return this.client.listProductCategories(query);
          case "productEcommerceCategories":
            return this.client.listProductEcommerceCategories(query);
          case "productEcommerceBrands":
            return this.client.listProductEcommerceBrands(query);
          case "cest":
            return this.client.listProductCest(query);
          case "ncm":
            return this.client.listProductNcm(query);
          case "units":
            return this.client.listProductUnits(query);
          case "sellers":
            return this.client.listSellers();
          case "serviceCategories":
            return this.client.searchServices(query);
          case "transfers":
            // /v1/financeiro/transferencias requires both data_inicio and
            // data_fim; default to a recent window for the reference preview.
            return this.client.listFinancialTransfers({
              ...query,
              data_inicio: referenceWindowStartDate(),
              data_fim: referenceWindowEndDate(),
            });
          case "products":
            return this.client.searchProducts(query);
          case "protocols":
            return Promise.resolve([]);
        }
      })();

      return {
        domain,
        items: extractContaAzulReferenceItems(response).map((item, index) =>
          normalizeContaAzulReferenceItem(item, `${domain}:${index + 1}`),
        ),
        nextCursor: null,
      };
    } catch (error) {
      // Reference catalogs are best-effort dropdown data. A client-side
      // rejection from Conta Azul (e.g. an endpoint whose required filters
      // don't apply to this account, like product-ecommerce-categories)
      // should yield an empty catalog, not fail the whole settings page.
      if (
        error instanceof ContaAzulApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        return { domain, items: [], nextCursor: null };
      }
      throw error;
    }
  }

  async upsertCustomer(
    payload: IntegrationCustomerPayload,
  ): Promise<RemoteEntityRef> {
    return this.upsertPessoa({
      ...payload,
      pessoaRole: "customer",
    });
  }

  async upsertPessoa(
    payload: IntegrationPessoaPayload,
  ): Promise<RemoteEntityRef> {
    const mappedPayload =
      payload.pessoaRole === "customer"
        ? mapCustomerToContaAzulPessoa(payload)
        : mapPessoaToContaAzulPessoa(payload);
    const target = getPessoaLinkTarget(payload.pessoaRole);
    const perfil = getPessoaProfile(mappedPayload);
    const linkedRemoteId =
      (await this.links?.getExistingRemoteId({
        target,
        localEntityId: payload.externalId,
      })) ?? null;
    const documentRemoteId = linkedRemoteId
      ? null
      : await this.findPessoaByDocument(mappedPayload);
    const remoteEntityId = linkedRemoteId ?? documentRemoteId;
    // PATCH /v1/pessoas/{id} returns 204 No Content per the Conta Azul docs —
    // the remote id we already have IS the source of truth. Only POST returns
    // a body with `id`, so only that branch needs the extractor.
    let resolvedRemoteId: string;
    if (remoteEntityId) {
      await this.client.patchPessoa(remoteEntityId, mappedPayload);
      resolvedRemoteId = remoteEntityId;
    } else {
      const response = await this.client.createPessoa(mappedPayload);
      resolvedRemoteId = extractContaAzulRemoteId(response);
    }

    await this.links?.upsertLink({
      target,
      localEntityId: payload.externalId,
      remoteEntityId: resolvedRemoteId,
      remoteDisplayId: resolvedRemoteId,
      remoteEntityType: "conta_azul_pessoa",
      metadata: {
        provider: this.provider,
        resource: "pessoas",
        pessoaRole: payload.pessoaRole,
        perfil,
        matchedBy: linkedRemoteId
          ? "object_link"
          : documentRemoteId
            ? "document"
            : "created",
      },
    });

    return {
      remoteEntityId: resolvedRemoteId,
      remoteDisplayId: resolvedRemoteId,
      remoteEntityType: "conta_azul_pessoa",
    };
  }

  async upsertSupplier(
    payload: IntegrationSupplierPayload,
  ): Promise<RemoteEntityRef> {
    return this.upsertPessoa(payload);
  }

  async upsertTransporter(
    payload: IntegrationTransporterPayload,
  ): Promise<RemoteEntityRef> {
    return this.upsertPessoa(payload);
  }

  async upsertCatalogItem(
    payload: IntegrationCatalogItemPayload,
  ): Promise<RemoteEntityRef> {
    // The Conta Azul catalog is split across two endpoints: /v1/produtos for
    // products and /v1/servicos for services. Dispatch on payload.kind so
    // calibration services land in the right place.
    return payload.kind === "service"
      ? this.upsertCatalogServico(payload)
      : this.upsertCatalogProduto(payload);
  }

  async fetchProductStock(
    remoteEntityId: string,
  ): Promise<{ quantity: number | null }> {
    const product = await this.client.getProduct<unknown>(remoteEntityId);
    return { quantity: extractContaAzulProductStockQuantity(product) };
  }

  async setProductStock(remoteEntityId: string, quantity: number) {
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error("Quantidade de estoque inválida");
    }
    // PATCH with the absolute quantity — Conta Azul records the entrada or
    // ajuste movement as the difference from the current balance.
    await this.client.patchProduct(remoteEntityId, {
      estoque: { quantidade: quantity },
    });
  }

  private async upsertCatalogProduto(
    payload: IntegrationCatalogItemPayload,
  ): Promise<RemoteEntityRef> {
    const mappedPayload = mapCatalogItemToContaAzulProduct(
      payload,
      this.config,
    );
    const linkedRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "catalog_item",
        localEntityId: payload.externalId,
      })) ??
      (await this.links?.getExistingRemoteId({
        target: "product",
        localEntityId: payload.externalId,
      })) ??
      (await this.links?.getExistingRemoteId({
        target: "service",
        localEntityId: payload.externalId,
      })) ??
      null;
    const skuRemoteId = linkedRemoteId
      ? null
      : await this.findProductBySku(mappedPayload);
    const remoteEntityId = linkedRemoteId ?? skuRemoteId;
    // patchProduct returns 204 No Content — same pattern as patchPessoa.
    // Reuse the known remote id; only the create path needs id extraction.
    let resolvedRemoteId: string;
    if (remoteEntityId) {
      await this.client.patchProduct(remoteEntityId, mappedPayload);
      resolvedRemoteId = remoteEntityId;
    } else {
      const response = await this.client.createProduct(mappedPayload);
      resolvedRemoteId = extractContaAzulRemoteId(response);
    }

    await this.links?.upsertLink({
      target: "catalog_item",
      localEntityId: payload.externalId,
      remoteEntityId: resolvedRemoteId,
      remoteDisplayId: resolvedRemoteId,
      remoteEntityType: "conta_azul_product",
      metadata: {
        provider: this.provider,
        resource: "produtos",
        catalogKind: payload.kind,
        sku: mappedPayload.codigo_sku ?? null,
        matchedBy: linkedRemoteId
          ? "object_link"
          : skuRemoteId
            ? "sku"
            : "created",
      },
    });

    return {
      remoteEntityId: resolvedRemoteId,
      remoteDisplayId: resolvedRemoteId,
      remoteEntityType: "conta_azul_product",
    };
  }

  private async upsertCatalogServico(
    payload: IntegrationCatalogItemPayload,
  ): Promise<RemoteEntityRef> {
    const mappedPayload = mapCatalogItemToContaAzulServico(payload);
    const linkedRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "catalog_item",
        localEntityId: payload.externalId,
      })) ??
      (await this.links?.getExistingRemoteId({
        target: "service",
        localEntityId: payload.externalId,
      })) ??
      (await this.links?.getExistingRemoteId({
        target: "product",
        localEntityId: payload.externalId,
      })) ??
      null;
    const codigoRemoteId = linkedRemoteId
      ? null
      : await this.findServicoByCodigo(mappedPayload);
    const remoteEntityId = linkedRemoteId ?? codigoRemoteId;
    // Same pattern as products: PATCH returns 204, POST returns 201 with `id`.
    let resolvedRemoteId: string;
    if (remoteEntityId) {
      await this.client.patchServico(remoteEntityId, mappedPayload);
      resolvedRemoteId = remoteEntityId;
    } else {
      const response = await this.client.createServico(mappedPayload);
      resolvedRemoteId = extractContaAzulRemoteId(response);
    }

    await this.links?.upsertLink({
      target: "catalog_item",
      localEntityId: payload.externalId,
      remoteEntityId: resolvedRemoteId,
      remoteDisplayId: resolvedRemoteId,
      remoteEntityType: "conta_azul_servico",
      metadata: {
        provider: this.provider,
        resource: "servicos",
        catalogKind: payload.kind,
        codigo: mappedPayload.codigo ?? null,
        matchedBy: linkedRemoteId
          ? "object_link"
          : codigoRemoteId
            ? "codigo"
            : "created",
      },
    });

    return {
      remoteEntityId: resolvedRemoteId,
      remoteDisplayId: resolvedRemoteId,
      remoteEntityType: "conta_azul_servico",
    };
  }

  private async listFinancialAccountBalances() {
    const accounts = extractContaAzulReferenceItems(
      await this.client.listFinancialAccounts({
        pagina: 1,
        tamanho_pagina: 100,
        apenas_ativo: true,
      }),
    );

    const balances: unknown[] = [];
    for (const [index, account] of accounts.entries()) {
      const accountRecord = toRecord(account);
      const accountId = optionalText(accountRecord.id);
      if (!accountId) {
        continue;
      }

      try {
        const balance = toRecord(
          await this.client.getFinancialAccountBalance(accountId),
        );
        balances.push({
          id: accountId,
          nome: optionalText(accountRecord.nome) ?? accountId,
          ativo: accountRecord.ativo,
          tipo: optionalText(accountRecord.tipo),
          valor: optionalNumber(balance.saldo_atual),
          conta_financeira: {
            id: accountId,
            nome: optionalText(accountRecord.nome),
          },
          sourceIndex: index,
        });
      } catch (error) {
        balances.push({
          id: accountId,
          nome: optionalText(accountRecord.nome) ?? accountId,
          ativo: accountRecord.ativo,
          tipo: optionalText(accountRecord.tipo),
          status: "unavailable",
          error: getSafeErrorMessage(error),
          sourceIndex: index,
        });
      }
    }

    return balances;
  }

  private async findPessoaByDocument(payload: ContaAzulPessoaPayload) {
    const document = getPayloadDocument(payload);
    if (!document) return null;
    const perfil = getPessoaProfile(payload);

    const response =
      await this.client.searchPessoas<ContaAzulPessoaSearchResponse>({
        pagina: 1,
        tamanho_pagina: CONTA_AZUL_MIN_SEARCH_PAGE_SIZE,
        documentos: document,
        tipo_perfil: perfil,
      });

    return selectPessoaByDocument(response, document);
  }

  private async findServicoByCodigo(payload: ContaAzulServicoPayload) {
    const codigo = payload.codigo?.trim();
    if (!codigo) return null;
    const response =
      await this.client.searchServices<ContaAzulServicoSearchResponse>({
        pagina: 1,
        tamanho_pagina: CONTA_AZUL_MIN_SEARCH_PAGE_SIZE,
        codigo,
      });
    return selectServicoByCodigo(response, codigo);
  }

  private async findProductBySku(payload: ContaAzulProductPayload) {
    const sku = getProductSku(payload);
    if (!sku) return null;

    const response =
      await this.client.searchProducts<ContaAzulProductSearchResponse>({
        pagina: 1,
        tamanho_pagina: CONTA_AZUL_MIN_SEARCH_PAGE_SIZE,
        sku,
        status: payload.status ?? "ATIVO",
      });

    return selectProductBySku(response, sku);
  }

  private async resolveCommercialItems(
    items: IntegrationCommercialItemPayload[],
  ): Promise<IntegrationCommercialItemPayload[]> {
    const resolvedItems: IntegrationCommercialItemPayload[] = [];

    for (const item of items) {
      const remoteItemId =
        item.remoteItemId ??
        (item.catalogItemExternalId
          ? await this.resolveCatalogItemRemoteId(item.catalogItemExternalId)
          : null);

      resolvedItems.push({
        ...item,
        remoteItemId,
      });
    }

    return resolvedItems;
  }

  private async resolveCatalogItemRemoteId(localEntityId: string) {
    return (
      (await this.links?.getExistingRemoteId({
        target: "catalog_item",
        localEntityId,
      })) ??
      (await this.links?.getExistingRemoteId({
        target: "product",
        localEntityId,
      })) ??
      (await this.links?.getExistingRemoteId({
        target: "service",
        localEntityId,
      })) ??
      null
    );
  }

  async exportBillingDocument(
    payload: IntegrationBillingDocumentPayload,
  ): Promise<RemoteEntityRef> {
    if (
      this.config.exportMode === "sale" ||
      this.config.exportMode === "sale_and_receivable"
    ) {
      return this.exportBillingDocumentAsSale(payload);
    }

    if (this.config.exportMode !== "receivable_event") {
      throw new Error(
        "Este modo de exportação da Conta Azul não exporta documentos financeiros diretamente; use venda, venda + recebível ou recebível conforme o fluxo configurado.",
      );
    }

    const existingRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "billing_document",
        localEntityId: payload.externalId,
      })) ?? null;
    if (existingRemoteId) {
      return {
        remoteEntityId: existingRemoteId,
        remoteDisplayId: existingRemoteId,
        remoteEntityType: "conta_azul_receivable_event",
      };
    }

    if (!payload.customerExternalId) {
      throw new Error("Documento financeiro sem cliente vinculado");
    }

    const remoteCustomerId =
      (await this.links?.getExistingRemoteId({
        target: "customer",
        localEntityId: payload.customerExternalId,
      })) ?? null;
    if (!remoteCustomerId) {
      throw new Error(
        "Cliente precisa ser sincronizado com a Conta Azul antes do faturamento",
      );
    }

    const response = await this.client.createReceivableEvent(
      mapBillingDocumentToReceivableEvent(
        payload,
        this.config,
        remoteCustomerId,
      ),
    );
    const remoteEntityId = extractContaAzulProtocolId(response);

    await this.links?.upsertLink({
      target: "billing_document",
      localEntityId: payload.externalId,
      remoteEntityId,
      remoteDisplayId: remoteEntityId,
      remoteEntityType: "conta_azul_receivable_protocol",
      metadata: {
        provider: this.provider,
        resource: "financeiro/eventos-financeiros/contas-a-receber",
        exportMode: this.config.exportMode,
      },
    });
    await this.syncProtocolStatus({
      localEntityId: `${payload.externalId}:protocol`,
      protocolId: remoteEntityId,
      source: "receivable_export",
      originTarget: "billing_document",
      originLocalEntityId: payload.externalId,
    });

    return {
      remoteEntityId,
      remoteDisplayId: remoteEntityId,
      remoteEntityType: "conta_azul_receivable_protocol",
    };
  }

  private async exportBillingDocumentAsSale(
    payload: IntegrationBillingDocumentPayload,
  ): Promise<RemoteEntityRef> {
    const sale = await this.exportSale(
      mapBillingDocumentToSalePayload(payload),
    );

    await this.links?.upsertLink({
      target: "billing_document",
      localEntityId: payload.externalId,
      remoteEntityId: sale.remoteEntityId,
      remoteDisplayId: sale.remoteDisplayId ?? sale.remoteEntityId,
      remoteEntityType: "conta_azul_sale",
      metadata: {
        provider: this.provider,
        resource: "venda",
        exportMode: this.config.exportMode,
        saleRemoteId: sale.remoteEntityId,
        saleDisplayId: sale.remoteDisplayId ?? null,
        receivableStrategy:
          this.config.exportMode === "sale_and_receivable"
            ? "sale_payment_condition"
            : "sale_only",
      },
    });

    return {
      remoteEntityId: sale.remoteEntityId,
      remoteDisplayId: sale.remoteDisplayId,
      remoteEntityType: "conta_azul_sale",
    };
  }

  async exportPayable(
    payload: IntegrationPayablePayload,
  ): Promise<RemoteEntityRef> {
    const existingRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "payable",
        localEntityId: payload.externalId,
      })) ?? null;
    if (existingRemoteId) {
      return {
        remoteEntityId: existingRemoteId,
        remoteDisplayId: existingRemoteId,
        remoteEntityType: "conta_azul_payable_event",
      };
    }

    if (!payload.supplierExternalId) {
      throw new Error("Conta a pagar sem fornecedor vinculado");
    }

    const remoteSupplierId =
      (await this.links?.getExistingRemoteId({
        target: "supplier",
        localEntityId: payload.supplierExternalId,
      })) ?? null;
    if (!remoteSupplierId) {
      throw new Error(
        "Fornecedor precisa ser sincronizado com a Conta Azul antes da conta a pagar",
      );
    }

    const response = await this.client.createPayableEvent(
      mapPayableToContaAzulPayableEvent(payload, this.config, remoteSupplierId),
    );
    const remoteEntityId = extractContaAzulProtocolId(response);

    await this.links?.upsertLink({
      target: "payable",
      localEntityId: payload.externalId,
      remoteEntityId,
      remoteDisplayId: remoteEntityId,
      remoteEntityType: "conta_azul_payable_protocol",
      metadata: {
        provider: this.provider,
        resource: "financeiro/eventos-financeiros/contas-a-pagar",
      },
    });
    await this.syncProtocolStatus({
      localEntityId: `${payload.externalId}:protocol`,
      protocolId: remoteEntityId,
      source: "payable_export",
      originTarget: "payable",
      originLocalEntityId: payload.externalId,
    });

    return {
      remoteEntityId,
      remoteDisplayId: remoteEntityId,
      remoteEntityType: "conta_azul_payable_protocol",
    };
  }

  private async syncProtocolStatus(params: {
    localEntityId: string;
    protocolId: string;
    source: string;
    originTarget: IntegrationObjectLinkTarget;
    originLocalEntityId: string;
  }) {
    if (!this.config.enabledTargets.protocols) {
      return;
    }

    if (this.config.protocolMode !== "api_lookup_verified") {
      await this.links?.upsertLink({
        target: "protocol",
        localEntityId: params.localEntityId,
        remoteEntityId: params.protocolId,
        remoteDisplayId: params.protocolId,
        remoteEntityType: "conta_azul_protocol",
        metadata: {
          provider: this.provider,
          resource: "protocolo",
          source: params.source,
          originTarget: params.originTarget,
          originLocalEntityId: params.originLocalEntityId,
          lookupStatus: "metadata_only",
          message:
            "Consulta remota de protocolos desativada por configuração; o OpenAPI oficial da Conta Azul expõe GET /v1/protocolo/{id}",
          syncedAt: new Date().toISOString(),
        },
      });
      return;
    }

    try {
      const protocol =
        await this.client.getProtocol<ContaAzulProtocolStatusResponse>(
          params.protocolId,
        );
      const remoteProtocolId = optionalText(protocol.id) ?? params.protocolId;
      const eventId = optionalText(protocol.evento_financeiro_id);

      await this.links?.upsertLink({
        target: "protocol",
        localEntityId: params.localEntityId,
        remoteEntityId: remoteProtocolId,
        remoteDisplayId: remoteProtocolId,
        remoteEntityType: "conta_azul_protocol",
        metadata: {
          provider: this.provider,
          resource: "protocolo",
          source: params.source,
          originTarget: params.originTarget,
          originLocalEntityId: params.originLocalEntityId,
          status: optionalText(protocol.status),
          responseMessage: optionalText(protocol.resposta),
          eventId,
          syncedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      await this.links?.upsertLink({
        target: "protocol",
        localEntityId: params.localEntityId,
        remoteEntityId: params.protocolId,
        remoteDisplayId: params.protocolId,
        remoteEntityType: "conta_azul_protocol",
        metadata: {
          provider: this.provider,
          resource: "protocolo",
          source: params.source,
          originTarget: params.originTarget,
          originLocalEntityId: params.originLocalEntityId,
          status: "unavailable",
          error: getSafeErrorMessage(error),
          syncedAt: new Date().toISOString(),
        },
      });
    }
  }

  async exportBudget(
    payload: IntegrationBudgetPayload,
  ): Promise<RemoteEntityRef> {
    const existingRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "budget",
        localEntityId: payload.externalId,
      })) ?? null;
    if (existingRemoteId) {
      return {
        remoteEntityId: existingRemoteId,
        remoteDisplayId: payload.budgetNumber ?? existingRemoteId,
        remoteEntityType: "conta_azul_budget_sale",
      };
    }

    if (!payload.customerExternalId) {
      throw new Error("Orçamento sem cliente vinculado");
    }

    const remoteCustomerId =
      (await this.links?.getExistingRemoteId({
        target: "customer",
        localEntityId: payload.customerExternalId,
      })) ?? null;
    if (!remoteCustomerId) {
      throw new Error(
        "Cliente precisa ser sincronizado com a Conta Azul antes de vincular orçamento",
      );
    }

    const budgetSale = await this.findContaAzulBudgetSale(
      payload,
      remoteCustomerId,
    );
    if (!budgetSale) {
      throw new Error(
        "Orçamentos são domínio obrigatório da integração Conta Azul, mas a documentação/FAQ oficial informa que não há endpoint de integração de orçamentos no momento. A OpenAPI atual de Vendas v1 permite consulta por situações de orçamento; nenhum orçamento remoto compatível foi encontrado para vínculo.",
      );
    }

    const remoteEntityId = extractContaAzulRemoteId(budgetSale);
    const remoteNumber = extractContaAzulSaleNumber(budgetSale);
    const situation = extractContaAzulSituationName(budgetSale);
    const remoteDisplayId =
      remoteNumber !== null
        ? String(remoteNumber)
        : (payload.budgetNumber ?? remoteEntityId);

    await this.links?.upsertLink({
      target: "budget",
      localEntityId: payload.externalId,
      remoteEntityId,
      remoteDisplayId,
      remoteEntityType: "conta_azul_budget_sale",
      metadata: {
        provider: this.provider,
        resource: "venda/busca",
        budgetMode: this.config.budgetMode,
        consultationOnly: true,
        matchedBy: "sales_search_budget_situation",
        customerRemoteId: remoteCustomerId,
        budgetNumber: payload.budgetNumber,
        issueDate: payload.issueDate,
        expirationDate: payload.expirationDate,
        situation,
      },
    });

    return {
      remoteEntityId,
      remoteDisplayId,
      remoteEntityType: "conta_azul_budget_sale",
    };
  }

  async exportSale(payload: IntegrationSalePayload): Promise<RemoteEntityRef> {
    if (!payload.customerExternalId) {
      throw new Error("Venda sem cliente vinculado");
    }

    const remoteCustomerId =
      (await this.links?.getExistingRemoteId({
        target: "customer",
        localEntityId: payload.customerExternalId,
      })) ?? null;
    if (!remoteCustomerId) {
      throw new Error(
        "Cliente precisa ser sincronizado com a Conta Azul antes da venda",
      );
    }

    const existingRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "sale",
        localEntityId: payload.externalId,
      })) ?? null;
    const saleNumber = existingRemoteId
      ? await this.getExistingSaleNumber(existingRemoteId, payload)
      : await this.getNewSaleNumber(payload);
    const resolvedItems = await this.resolveCommercialItems(payload.items);
    const mappedPayload = mapSaleToContaAzulSale(
      {
        ...payload,
        items: resolvedItems,
      },
      this.config,
      remoteCustomerId,
      saleNumber,
    );
    const response = existingRemoteId
      ? await this.client.putSale(existingRemoteId, mappedPayload)
      : await this.client.createSale(mappedPayload);
    const remoteEntityId = extractContaAzulRemoteId(response);

    await this.links?.upsertLink({
      target: "sale",
      localEntityId: payload.externalId,
      remoteEntityId,
      remoteDisplayId: String(mappedPayload.numero),
      remoteEntityType: "conta_azul_sale",
      metadata: {
        provider: this.provider,
        resource: "venda",
        exportMode: this.config.exportMode,
        saleNumber: mappedPayload.numero,
        matchedBy: existingRemoteId ? "object_link" : "created",
      },
    });

    await this.syncSalePdfRemoteDocument({
      localSaleId: payload.externalId,
      saleNumber: mappedPayload.numero,
      remoteSaleId: remoteEntityId,
    });

    return {
      remoteEntityId,
      remoteDisplayId: String(mappedPayload.numero),
      remoteEntityType: "conta_azul_sale",
    };
  }

  async upsertContract(
    payload: IntegrationContractPayload,
  ): Promise<RemoteEntityRef> {
    if (!payload.customerExternalId) {
      throw new Error("Contrato sem cliente vinculado");
    }

    const remoteCustomerId =
      (await this.links?.getExistingRemoteId({
        target: "customer",
        localEntityId: payload.customerExternalId,
      })) ?? null;
    if (!remoteCustomerId) {
      throw new Error(
        "Cliente precisa ser sincronizado com a Conta Azul antes do contrato",
      );
    }

    const existingRemoteId =
      (await this.links?.getExistingRemoteId({
        target: "contract",
        localEntityId: payload.externalId,
      })) ?? null;
    if (existingRemoteId) {
      return {
        remoteEntityId: existingRemoteId,
        remoteDisplayId: payload.contractNumber ?? existingRemoteId,
        remoteEntityType: "conta_azul_contract",
      };
    }

    const contractNumber = await this.getNewContractNumber(payload);
    const resolvedItems = await this.resolveCommercialItems(payload.items);
    const mappedPayload = mapContractToContaAzulContract(
      {
        ...payload,
        items: resolvedItems,
      },
      this.config,
      remoteCustomerId,
      contractNumber,
    );
    const response = await this.client.createContract(mappedPayload);
    const remoteEntityId = extractContaAzulRemoteId(response);
    const generatedSaleId = extractContaAzulGeneratedSaleId(response);

    await this.links?.upsertLink({
      target: "contract",
      localEntityId: payload.externalId,
      remoteEntityId,
      remoteDisplayId: String(mappedPayload.termos.numero),
      remoteEntityType: "conta_azul_contract",
      metadata: {
        provider: this.provider,
        resource: "contratos",
        contractNumber: mappedPayload.termos.numero,
        customerRemoteId: remoteCustomerId,
        startsAt: payload.startsAt ?? payload.issueDate,
        endsAt: payload.endsAt,
        generatedSales: true,
        generatedSaleRemoteId: generatedSaleId,
        matchedBy: "created",
      },
    });

    if (generatedSaleId) {
      await this.links?.upsertLink({
        target: "sale",
        localEntityId: `${payload.externalId}:generated-sale`,
        remoteEntityId: generatedSaleId,
        remoteDisplayId: String(mappedPayload.termos.numero),
        remoteEntityType: "conta_azul_contract_generated_sale",
        metadata: {
          provider: this.provider,
          resource: "contratos",
          source: "contract_generated",
          contractLocalEntityId: payload.externalId,
          contractRemoteId: remoteEntityId,
          contractNumber: mappedPayload.termos.numero,
          customerRemoteId: remoteCustomerId,
          generatedByContract: true,
          revenueDuplicationGuard: true,
        },
      });
    }

    return {
      remoteEntityId,
      remoteDisplayId: String(mappedPayload.termos.numero),
      remoteEntityType: "conta_azul_contract",
    };
  }

  private async getNewContractNumber(payload: IntegrationContractPayload) {
    const payloadNumber = parsePositiveInteger(payload.contractNumber);
    if (payloadNumber !== null) {
      return payloadNumber;
    }

    const response = await this.client.getNextContractNumber();
    const remoteNumber = extractContaAzulSaleNumber(response);
    if (remoteNumber === null) {
      throw new Error("Conta Azul não retornou próximo número de contrato");
    }

    return remoteNumber;
  }

  private async getNewSaleNumber(payload: IntegrationSalePayload) {
    const payloadNumber = parseSaleNumber(payload.saleNumber);
    if (payloadNumber !== null) {
      return payloadNumber;
    }

    const response = await this.client.getNextSaleNumber();
    const remoteNumber = extractContaAzulSaleNumber(response);
    if (remoteNumber === null) {
      throw new Error("Conta Azul não retornou próximo número de venda");
    }

    return remoteNumber;
  }

  private async findContaAzulBudgetSale(
    payload: IntegrationBudgetPayload,
    remoteCustomerId: string,
  ) {
    const saleNumber = parseSaleNumber(payload.budgetNumber);
    const query: Record<string, string | number | string[] | number[]> = {
      pagina: 1,
      tamanho_pagina: 50,
      ids_clientes: [remoteCustomerId],
      situacoes: [...CONTA_AZUL_BUDGET_SALE_SITUATIONS],
    };

    if (saleNumber !== null) {
      query.numeros = [saleNumber];
    } else if (payload.budgetNumber?.trim()) {
      query.termo_busca = payload.budgetNumber.trim();
    }
    if (payload.issueDate) {
      query.data_inicio = payload.issueDate;
      query.data_fim = payload.issueDate;
    }

    const response = await this.client.searchSales(query);
    const items = extractContaAzulReferenceItems(response);
    const match =
      items.find((item) =>
        this.isContaAzulBudgetSaleMatch(item, {
          remoteCustomerId,
          saleNumber,
        }),
      ) ?? null;

    return match;
  }

  private isContaAzulBudgetSaleMatch(
    item: unknown,
    params: {
      remoteCustomerId: string;
      saleNumber: number | null;
    },
  ) {
    const situation = extractContaAzulSituationName(item);
    if (!situation || !isContaAzulBudgetSaleSituation(situation)) {
      return false;
    }

    const customerId = extractContaAzulSaleCustomerId(item);
    if (customerId && customerId !== params.remoteCustomerId) {
      return false;
    }

    if (params.saleNumber === null) {
      return true;
    }

    return extractContaAzulSaleNumber(item) === params.saleNumber;
  }

  private async getExistingSaleNumber(
    remoteSaleId: string,
    payload: IntegrationSalePayload,
  ) {
    const response = await this.client.getSale(remoteSaleId);
    const remoteNumber = extractContaAzulSaleNumber(response);
    if (remoteNumber !== null) {
      return remoteNumber;
    }

    const payloadNumber = parseSaleNumber(payload.saleNumber);
    if (payloadNumber !== null) {
      return payloadNumber;
    }

    throw new Error("Venda vinculada na Conta Azul não retornou número remoto");
  }

  private async syncSalePdfRemoteDocument(params: {
    localSaleId: string;
    remoteSaleId: string;
    saleNumber: number;
  }) {
    if (!this.config.enabledTargets.remoteDocuments) {
      return;
    }

    const localEntityId = `${params.localSaleId}:sale_pdf`;

    try {
      const pdf = await this.client.getSalePdf(params.remoteSaleId);

      await this.links?.upsertLink({
        target: "remote_document",
        localEntityId,
        remoteEntityId: `${params.remoteSaleId}:pdf`,
        remoteDisplayId: `Venda ${params.saleNumber} PDF`,
        remoteEntityType: "conta_azul_sale_pdf",
        metadata: {
          provider: this.provider,
          resource: "venda/{id}/imprimir",
          source: "sale_export",
          documentKind: "sale_pdf",
          saleRemoteId: params.remoteSaleId,
          saleNumber: params.saleNumber,
          contentType: pdf.contentType,
          byteLength: pdf.body.byteLength,
          downloadableViaApi: true,
          status: "available",
          syncedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      await this.links?.upsertLink({
        target: "remote_document",
        localEntityId,
        remoteEntityId: `${params.remoteSaleId}:pdf`,
        remoteDisplayId: `Venda ${params.saleNumber} PDF`,
        remoteEntityType: "conta_azul_sale_pdf",
        metadata: {
          provider: this.provider,
          resource: "venda/{id}/imprimir",
          source: "sale_export",
          documentKind: "sale_pdf",
          saleRemoteId: params.remoteSaleId,
          saleNumber: params.saleNumber,
          downloadableViaApi: true,
          status: "unavailable",
          error: getSafeErrorMessage(error),
          syncedAt: new Date().toISOString(),
        },
      });
    }
  }

  async pollPayableStatus(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult> {
    if (!this.config.enabledTargets.payables) {
      throw new Error(
        "Polling de contas a pagar da Conta Azul está desativado",
      );
    }

    const requestedLimit = Math.max(
      1,
      Math.min(
        typeof cursor.state?.requestedLimit === "number"
          ? cursor.state.requestedLimit
          : 50,
        200,
      ),
    );
    const pageSize = Math.min(requestedLimit, 100);
    const window = getPayablePollWindow(cursor);
    let processedCount = 0;
    let updatedCount = 0;
    let nextPage: number | null = null;
    const warnings: string[] = [];
    const page =
      typeof cursor.nextPage === "number" && cursor.nextPage > 0
        ? cursor.nextPage
        : 1;

    const response =
      await this.client.searchPayableEvents<ContaAzulPayableSearchResponse>({
        pagina: page,
        tamanho_pagina: clampContaAzulPageSize(pageSize),
        data_vencimento_de: toDateOnly(window.dueDateFrom),
        data_vencimento_ate: toDateOnly(window.dueDateTo),
        data_alteracao_de: toContaAzulDateTime(window.start),
        data_alteracao_ate: toContaAzulDateTime(window.end),
      });
    const items = extractPayableItems(response);
    const consumedItems = items.slice(0, requestedLimit);
    processedCount = consumedItems.length;

    for (const item of consumedItems) {
      const installment = item.id
        ? await this.client.getInstallment<ContaAzulInstallment>(item.id)
        : item;
      const payableExternalId = extractPayableExternalId(installment);
      if (!payableExternalId) {
        warnings.push(`Parcela a pagar ${installment.id} sem referência local`);
      }

      const acquittances = this.config.enabledTargets.baixas
        ? extractAcquittanceItems(
            await this.client.listInstallmentAcquittances(installment.id),
          )
        : [];

      if (installment.evento?.id && payableExternalId) {
        await this.links?.upsertLink({
          target: "payable",
          localEntityId: payableExternalId,
          remoteEntityId: installment.evento.id,
          remoteDisplayId: installment.evento.id,
          remoteEntityType: "conta_azul_payable_event",
          metadata: {
            provider: this.provider,
            resource: "financeiro/eventos-financeiros/contas-a-pagar",
            source: "payable_poll",
          },
        });
      }

      await this.links?.upsertLink({
        target: "payable_installment",
        localEntityId: payableExternalId
          ? `${payableExternalId}:installment:${installment.indice ?? installment.id}`
          : `remote:payable_installment:${installment.id}`,
        remoteEntityId: installment.id,
        remoteDisplayId: installment.id,
        remoteEntityType: "conta_azul_payable_installment",
        metadata: buildPayableInstallmentMetadata({
          installment,
          payableExternalId,
          acquittanceCount: acquittances.length,
        }),
      });

      for (const acquittance of acquittances) {
        const acquittanceId = getAcquittanceId(acquittance);
        if (!acquittanceId) continue;

        await this.links?.upsertLink({
          target: "baixa",
          localEntityId: `baixa:${acquittanceId}`,
          remoteEntityId: acquittanceId,
          remoteDisplayId: acquittanceId,
          remoteEntityType: "conta_azul_baixa",
          metadata: {
            provider: this.provider,
            resource: "financeiro/eventos-financeiros/parcelas/baixa",
            source: "payable_poll",
            installmentId: installment.id,
            payableExternalId,
          },
        });
      }

      updatedCount += 1;
    }

    const totalItems = extractPayableTotalItems(response);
    nextPage =
      consumedItems.length < items.length ||
      (items.length >= pageSize &&
        (totalItems === null || page * pageSize < totalItems))
        ? page + 1
        : null;

    const completedWindow = nextPage === null;
    const nextCursor: IntegrationSyncCursor = {
      cursorType: cursor.cursorType || "conta_azul_payables",
      lastRemoteUpdatedAt: completedWindow
        ? window.end.toISOString()
        : cursor.lastRemoteUpdatedAt,
      lastSuccessfulPollAt: new Date().toISOString(),
      nextPage,
      state: {
        ...cursor.state,
        processedCount: consumedItems.length,
        updatedCount,
        requestedLimit,
        pageSize,
        totalItems,
        dueDateFrom: toDateOnly(window.dueDateFrom),
        dueDateTo: toDateOnly(window.dueDateTo),
        ...(nextPage ? { windowEndAt: window.end.toISOString() } : {}),
      },
    };

    return {
      processedCount,
      updatedCount,
      cursor: nextCursor,
      warnings,
    };
  }

  async pollFiscalDocuments(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult> {
    if (!this.config.enabledTargets.fiscalDocuments) {
      throw new Error("Sincronização fiscal da Conta Azul está desativada");
    }

    const requestedLimit = Math.max(
      1,
      Math.min(
        typeof cursor.state?.requestedLimit === "number"
          ? cursor.state.requestedLimit
          : 50,
        100,
      ),
    );
    const pageSize = Math.min(requestedLimit, 50);
    const window = getFiscalWindow(cursor);
    let processedCount = 0;
    let updatedCount = 0;
    let nextPage: number | null = null;
    let nextDocumentType: FiscalDocumentPollType | null = null;
    const warnings: string[] = [];

    const startType = getCursorFiscalPollType(cursor);
    const startPage =
      typeof cursor.nextPage === "number" && cursor.nextPage > 0
        ? cursor.nextPage
        : 1;

    if (startType === "nfe") {
      const nfeResult = await this.pollProductInvoices({
        window,
        page: startPage,
        pageSize,
        remainingLimit: requestedLimit - processedCount,
      });
      processedCount += nfeResult.processedCount;
      updatedCount += nfeResult.updatedCount;

      if (nfeResult.nextPage !== null) {
        nextPage = nfeResult.nextPage;
        nextDocumentType = "nfe";
      } else if (processedCount >= requestedLimit) {
        nextPage = 1;
        nextDocumentType = "nfse";
      }
    }

    if (nextDocumentType === null && processedCount < requestedLimit) {
      const nfseResult = await this.pollServiceInvoices({
        window,
        page: startType === "nfse" ? startPage : 1,
        pageSize,
        remainingLimit: requestedLimit - processedCount,
      });
      processedCount += nfseResult.processedCount;
      updatedCount += nfseResult.updatedCount;

      if (nfseResult.nextPage !== null) {
        nextPage = nfseResult.nextPage;
        nextDocumentType = "nfse";
      }
    }

    const completedWindow = nextDocumentType === null;
    const nextLastRemoteUpdatedAt = completedWindow
      ? window.end.toISOString()
      : cursor.lastRemoteUpdatedAt;
    const nextCursor: IntegrationSyncCursor = {
      cursorType: cursor.cursorType || CONTA_AZUL_FISCAL_CURSOR_TYPE,
      lastRemoteUpdatedAt: nextLastRemoteUpdatedAt,
      lastSuccessfulPollAt: new Date().toISOString(),
      nextPage,
      state: {
        ...cursor.state,
        processedCount,
        updatedCount,
        requestedLimit,
        pageSize,
        ...(nextDocumentType
          ? {
              documentType: nextDocumentType,
              windowEndAt: window.end.toISOString(),
            }
          : {
              documentType: null,
              windowEndAt: null,
            }),
      },
    };

    if (this.config.fiscalMode === "consultation_only") {
      warnings.push("Modo fiscal da Conta Azul está configurado como consulta");
    }

    return {
      processedCount,
      updatedCount,
      cursor: nextCursor,
      warnings,
    };
  }

  async pollProtocols(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult> {
    if (!this.config.enabledTargets.protocols) {
      throw new Error("Polling de protocolos da Conta Azul está desativado");
    }

    if (this.config.protocolMode !== "api_lookup_verified") {
      return {
        processedCount: 0,
        updatedCount: 0,
        cursor: {
          cursorType: cursor.cursorType || "conta_azul_protocols",
          lastRemoteUpdatedAt: cursor.lastRemoteUpdatedAt,
          lastSuccessfulPollAt: new Date().toISOString(),
          nextPage: null,
          state: {
            ...cursor.state,
            protocolMode: this.config.protocolMode,
          },
        },
        warnings: [
          "Protocolos estão em modo metadados; consulta remota via GET /v1/protocolo/{id} desativada por configuração",
        ],
      };
    }

    const requestedLimit = Math.max(
      1,
      Math.min(getCursorStateNumber(cursor, "requestedLimit", 50), 200),
    );
    const offset = Math.max(0, getCursorStateNumber(cursor, "offset", 0));
    const warnings: string[] = [];

    if (!this.links?.listLinks) {
      return {
        processedCount: 0,
        updatedCount: 0,
        cursor: {
          cursorType: cursor.cursorType || "conta_azul_protocols",
          lastRemoteUpdatedAt: cursor.lastRemoteUpdatedAt,
          lastSuccessfulPollAt: new Date().toISOString(),
          nextPage: null,
          state: {
            ...cursor.state,
            requestedLimit,
            offset,
          },
        },
        warnings: ["Object links indisponíveis para polling de protocolos"],
      };
    }

    const links = await this.links.listLinks({
      targets: ["protocol"],
      limit: requestedLimit,
      offset,
    });

    let processedCount = 0;
    let updatedCount = 0;
    for (const link of links) {
      if (!link.remoteEntityId) {
        continue;
      }

      processedCount += 1;
      try {
        const protocol =
          await this.client.getProtocol<ContaAzulProtocolStatusResponse>(
            link.remoteEntityId,
          );
        const remoteProtocolId =
          optionalText(protocol.id) ?? link.remoteEntityId;
        const eventId = optionalText(protocol.evento_financeiro_id);

        await this.links.upsertLink({
          ...link,
          remoteEntityId: remoteProtocolId,
          remoteDisplayId: remoteProtocolId,
          remoteEntityType: "conta_azul_protocol",
          metadata: {
            ...toRecord(link.metadata),
            provider: this.provider,
            resource: "protocolo",
            source: "protocol_poll",
            status: optionalText(protocol.status),
            responseMessage: optionalText(protocol.resposta),
            eventId,
            syncedAt: new Date().toISOString(),
          },
        });
        updatedCount += 1;
      } catch (error) {
        await this.links.upsertLink({
          ...link,
          metadata: {
            ...toRecord(link.metadata),
            provider: this.provider,
            resource: "protocolo",
            source: "protocol_poll",
            status: "unavailable",
            error: getSafeErrorMessage(error),
            syncedAt: new Date().toISOString(),
          },
        });
        updatedCount += 1;
        warnings.push(
          `Falha ao consultar protocolo ${link.remoteEntityId}: ${getSafeErrorMessage(
            error,
          )}`,
        );
      }
    }

    const nextOffset =
      links.length >= requestedLimit ? offset + links.length : 0;

    return {
      processedCount,
      updatedCount,
      cursor: {
        cursorType: cursor.cursorType || "conta_azul_protocols",
        lastRemoteUpdatedAt: new Date().toISOString(),
        lastSuccessfulPollAt: new Date().toISOString(),
        nextPage: nextOffset > 0 ? 1 : null,
        state: {
          ...cursor.state,
          requestedLimit,
          offset: nextOffset,
        },
      },
      warnings,
    };
  }

  async linkFiscalDocumentsToMdfe(
    payload: IntegrationMdfeLinkPayload,
  ): Promise<RemoteEntityRef> {
    if (!this.config.enabledTargets.fiscalDocuments) {
      throw new Error("Sincronização fiscal da Conta Azul está desativada");
    }
    if (this.config.fiscalMode === "disabled") {
      throw new Error("Modo fiscal da Conta Azul está desativado");
    }

    const mappedPayload = mapMdfeLinkToContaAzulPayload(payload);
    await this.client.linkInvoicesToMdfe(mappedPayload);

    await this.links?.upsertLink({
      target: "fiscal_document",
      localEntityId: `mdfe_link:${payload.externalId}`,
      remoteEntityId: mappedPayload.identificador,
      remoteDisplayId: mappedPayload.identificador,
      remoteEntityType: "conta_azul_mdfe_link",
      metadata: {
        provider: this.provider,
        resource: "notas-fiscais/vinculo-mdfe",
        source: "mdfe_link",
        fiscalDocumentType: "mdfe_link",
        accessKeyCount: mappedPayload.chaves_acesso.length,
        accessKeys: summarizeFiscalAccessKeys(mappedPayload.chaves_acesso),
        mdfeIdentifier: mappedPayload.identificador,
        status: mappedPayload.status ?? null,
        consultationOnly: this.config.fiscalMode === "consultation_only",
        linkedAt: new Date().toISOString(),
      },
    });

    return {
      remoteEntityId: mappedPayload.identificador,
      remoteDisplayId: mappedPayload.identificador,
      remoteEntityType: "conta_azul_mdfe_link",
    };
  }

  async pollRemoteDrift(
    cursor: IntegrationSyncCursor,
  ): Promise<RemoteStatusPollResult> {
    if (!this.config.enabledTargets.driftChecks) {
      throw new Error("Verificação de drift da Conta Azul está desativada");
    }

    const requestedLimit = Math.max(
      1,
      Math.min(getCursorStateNumber(cursor, "requestedLimit", 50), 200),
    );
    const offset = Math.max(0, getCursorStateNumber(cursor, "offset", 0));
    const warnings: string[] = [];

    if (!this.links?.listLinks) {
      return {
        processedCount: 0,
        updatedCount: 0,
        cursor: {
          cursorType: cursor.cursorType || "conta_azul_remote_drift",
          lastRemoteUpdatedAt: cursor.lastRemoteUpdatedAt,
          lastSuccessfulPollAt: new Date().toISOString(),
          nextPage: null,
          state: {
            ...cursor.state,
            requestedLimit,
            offset,
          },
        },
        warnings: ["Object links indisponíveis para verificação de drift"],
      };
    }

    const links = await this.links.listLinks({
      targets: [
        "customer",
        "supplier",
        "transporter",
        "service",
        "product",
        "catalog_item",
        "category",
        "cost_center",
        "dre_category",
        "financial_account",
        "financial_transfer",
        "seller",
        "budget",
        "sale",
        "billing_document",
        "contract",
        "payable",
        "payable_installment",
        "receivable_installment",
        "baixa",
        "fiscal_document",
        "remote_document",
        "protocol",
      ],
      limit: requestedLimit,
      offset,
    });

    let processedCount = 0;
    let updatedCount = 0;
    for (const link of links) {
      if (!link.remoteEntityId) {
        continue;
      }

      processedCount += 1;
      const checkedAt = new Date().toISOString();
      try {
        const supported = await this.checkLinkedRemoteRecord(link);
        if (!supported) {
          warnings.push(`Drift sem consulta oficial para ${link.target}`);
          continue;
        }

        await this.links.upsertLink({
          ...link,
          metadata: {
            ...toRecord(link.metadata),
            drift: {
              status: "remote_present",
              checkedAt,
              source: "drift_poll",
            },
          },
        });
        updatedCount += 1;
      } catch (error) {
        if (error instanceof ContaAzulApiError && error.status === 404) {
          await this.links.upsertLink({
            ...link,
            metadata: {
              ...toRecord(link.metadata),
              drift: {
                status: "remote_missing",
                checkedAt,
                source: "drift_poll",
                reason: "not_found",
              },
            },
          });
          updatedCount += 1;
          continue;
        }

        warnings.push(
          `Falha ao verificar drift de ${link.target}:${link.localEntityId}: ${getSafeErrorMessage(
            error,
          )}`,
        );
      }
    }

    const nextOffset =
      links.length >= requestedLimit ? offset + links.length : 0;

    return {
      processedCount,
      updatedCount,
      cursor: {
        cursorType: cursor.cursorType || "conta_azul_remote_drift",
        lastRemoteUpdatedAt: new Date().toISOString(),
        lastSuccessfulPollAt: new Date().toISOString(),
        nextPage: nextOffset > 0 ? 1 : null,
        state: {
          ...cursor.state,
          requestedLimit,
          offset: nextOffset,
        },
      },
      warnings,
    };
  }

  private async checkLinkedRemoteRecord(link: {
    target: IntegrationObjectLinkTarget;
    remoteEntityId: string | null;
    remoteEntityType?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    if (!link.remoteEntityId) {
      return false;
    }

    switch (link.target) {
      case "customer":
      case "supplier":
      case "transporter":
        await this.client.getPessoa(link.remoteEntityId);
        return true;
      case "product":
        await this.client.getProduct(link.remoteEntityId);
        return true;
      case "catalog_item":
      case "category":
      case "cost_center":
      case "dre_category":
      case "financial_account":
      case "financial_transfer":
      case "seller":
        return this.checkLinkedReferenceRecord(link);
      case "service":
        return this.checkLinkedServiceReference(link);
      case "budget":
        return this.checkLinkedBudgetSale(link);
      case "sale":
        await this.client.getSale(link.remoteEntityId);
        return true;
      case "contract":
        return this.checkLinkedContract(link);
      case "billing_document":
        if (link.remoteEntityType === "conta_azul_sale") {
          await this.client.getSale(link.remoteEntityId);
          return true;
        }
        if (link.remoteEntityType === "conta_azul_receivable_event") {
          await this.client.getInstallmentsByEventId(link.remoteEntityId);
          return true;
        }
        if (link.remoteEntityType === "conta_azul_receivable_protocol") {
          await this.client.getProtocol(link.remoteEntityId);
          return true;
        }
        return false;
      case "payable":
        if (link.remoteEntityType === "conta_azul_payable_event") {
          await this.client.getInstallmentsByEventId(link.remoteEntityId);
          return true;
        }
        if (link.remoteEntityType === "conta_azul_payable_protocol") {
          await this.client.getProtocol(link.remoteEntityId);
          return true;
        }
        return false;
      case "payable_installment":
      case "receivable_installment":
        await this.client.getInstallment(link.remoteEntityId);
        return true;
      case "baixa":
        await this.client.getAcquittance(link.remoteEntityId);
        return true;
      case "fiscal_document":
        return this.checkLinkedFiscalDocument(link);
      case "remote_document":
        return this.checkLinkedRemoteDocument(link);
      case "protocol":
        await this.client.getProtocol(link.remoteEntityId);
        return true;
      default:
        return false;
    }
  }

  private async checkLinkedReferenceRecord(link: {
    target: IntegrationObjectLinkTarget;
    remoteEntityId: string | null;
    remoteEntityType?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    if (!link.remoteEntityId) {
      return false;
    }

    const metadata = toRecord(link.metadata);
    const domain =
      getReferenceDomainFromMetadata(metadata.domain) ??
      inferReferenceDomainFromRemoteEntityType(link.remoteEntityType);
    if (!domain) {
      return false;
    }

    const page = await this.listReferenceData(domain);
    const exists = page.items.some((item) => item.id === link.remoteEntityId);
    if (!exists) {
      throw new ContaAzulApiError({
        status: 404,
        code: "CONTA_AZUL_REMOTE_DRIFT",
        message: `Referência ${domain} vinculada não encontrada na listagem oficial`,
      });
    }

    return true;
  }

  private async checkLinkedServiceReference(link: {
    remoteEntityId: string | null;
  }) {
    if (!link.remoteEntityId) {
      return false;
    }

    const response = await this.client.searchServices({
      pagina: 1,
      tamanho_pagina: 100,
    });
    const exists = extractContaAzulReferenceItems(response).some(
      (item) => extractRemoteId(item) === link.remoteEntityId,
    );

    if (!exists) {
      throw new ContaAzulApiError({
        status: 404,
        code: "CONTA_AZUL_REMOTE_DRIFT",
        message: "Serviço vinculado não encontrado na listagem oficial",
      });
    }

    return true;
  }

  private async checkLinkedBudgetSale(link: {
    remoteEntityId: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    if (!link.remoteEntityId) {
      return false;
    }

    const metadata = toRecord(link.metadata);
    const query: Record<string, string | number | string[] | number[]> = {
      pagina: 1,
      tamanho_pagina: 50,
      situacoes: [...CONTA_AZUL_BUDGET_SALE_SITUATIONS],
    };
    const customerRemoteId = optionalText(metadata.customerRemoteId);
    if (customerRemoteId) {
      query.ids_clientes = [customerRemoteId];
    }

    const budgetNumber = optionalText(metadata.budgetNumber);
    const parsedBudgetNumber = parseSaleNumber(budgetNumber);
    if (parsedBudgetNumber !== null) {
      query.numeros = [parsedBudgetNumber];
    } else if (budgetNumber) {
      query.termo_busca = budgetNumber;
    }

    const issueDate = optionalText(metadata.issueDate);
    if (issueDate) {
      query.data_inicio = issueDate;
      query.data_fim = issueDate;
    }

    if (!customerRemoteId && parsedBudgetNumber === null && !budgetNumber) {
      return false;
    }

    const response = await this.client.searchSales(query);
    const items = extractContaAzulReferenceItems(response);
    const exists = items.some((item) => {
      const remoteId = extractRemoteId(item);
      const remoteNumber = extractContaAzulSaleNumber(item);
      const situation = extractContaAzulSituationName(item);
      return (
        (remoteId === link.remoteEntityId ||
          (parsedBudgetNumber !== null &&
            remoteNumber === parsedBudgetNumber)) &&
        Boolean(situation && isContaAzulBudgetSaleSituation(situation))
      );
    });

    if (!exists) {
      throw new ContaAzulApiError({
        status: 404,
        code: "CONTA_AZUL_REMOTE_DRIFT",
        message: "Orçamento vinculado não encontrado na consulta oficial",
      });
    }

    return true;
  }

  private async checkLinkedContract(link: {
    remoteEntityId: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    if (!link.remoteEntityId) {
      return false;
    }

    const metadata = toRecord(link.metadata);
    const window = getContractDriftWindow(metadata);
    if (!window) {
      return false;
    }

    const query: Record<string, string | number> = {
      pagina: 1,
      tamanho_pagina: 50,
      data_inicio: window.start,
      data_fim: window.end,
    };
    const customerRemoteId = optionalText(metadata.customerRemoteId);
    if (customerRemoteId) {
      query.cliente_id = customerRemoteId;
    }

    const response = await this.client.searchContracts(query);
    const items = extractContaAzulReferenceItems(response);
    const contractNumber = optionalNumber(metadata.contractNumber);
    const exists = items.some((item) => {
      const record = toRecord(item);
      const remoteId = optionalText(record.id);
      const remoteNumber = optionalNumber(record.numero);
      return (
        remoteId === link.remoteEntityId ||
        (contractNumber !== null && remoteNumber === contractNumber)
      );
    });

    if (!exists) {
      throw new ContaAzulApiError({
        status: 404,
        code: "CONTA_AZUL_REMOTE_DRIFT",
        message: "Contrato vinculado não encontrado na consulta oficial",
      });
    }

    return true;
  }

  private async checkLinkedFiscalDocument(link: {
    remoteEntityId: string | null;
    remoteEntityType?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    if (!link.remoteEntityId) {
      return false;
    }

    if (link.remoteEntityType === "conta_azul_nfe") {
      await this.client.getInvoiceByAccessKey(link.remoteEntityId);
      return true;
    }

    if (link.remoteEntityType === "conta_azul_nfse") {
      const date = getServiceInvoiceDriftDate(link.metadata);
      if (!date) {
        return false;
      }

      const response =
        await this.client.searchServiceInvoices<ContaAzulServiceInvoiceSearchResponse>(
          {
            ids: link.remoteEntityId,
            data_competencia_de: date,
            data_competencia_ate: date,
            pagina: 1,
            tamanho_pagina: 10,
          },
        );
      const exists = extractServiceInvoices(response).some(
        (invoice) => optionalText(invoice.id) === link.remoteEntityId,
      );
      if (!exists) {
        throw new ContaAzulApiError({
          status: 404,
          code: "CONTA_AZUL_REMOTE_DRIFT",
          message: "NFS-e vinculada não encontrada na consulta oficial",
        });
      }

      return true;
    }

    return false;
  }

  private async checkLinkedRemoteDocument(link: {
    remoteEntityId: string | null;
    remoteEntityType?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const metadata = toRecord(link.metadata);

    if (link.remoteEntityType === "conta_azul_sale_pdf") {
      const saleRemoteId = optionalText(metadata.saleRemoteId);
      if (!saleRemoteId) {
        return false;
      }

      await this.client.getSalePdf(saleRemoteId);
      return true;
    }

    if (link.remoteEntityType === "conta_azul_fiscal_xml") {
      const accessKey =
        optionalText(metadata.accessKey) ??
        optionalText(link.remoteEntityId)?.replace(/:xml$/, "") ??
        null;
      if (!accessKey) {
        return false;
      }

      await this.client.getInvoiceByAccessKey(accessKey);
      return true;
    }

    return false;
  }

  private async pollProductInvoices(params: {
    window: { start: Date; end: Date };
    page: number;
    pageSize: number;
    remainingLimit: number;
  }) {
    if (params.remainingLimit <= 0) {
      return { processedCount: 0, updatedCount: 0, nextPage: params.page };
    }

    const response =
      await this.client.searchProductInvoices<ContaAzulProductInvoiceSearchResponse>(
        {
          data_inicial: toDateOnly(params.window.start),
          data_final: toDateOnly(params.window.end),
          pagina: params.page,
          tamanho_pagina: clampContaAzulPageSize(params.pageSize),
        },
      );
    const items = extractProductInvoices(response);
    const consumedItems = items.slice(0, params.remainingLimit);

    for (const [index, item] of consumedItems.entries()) {
      const metadata = mapContaAzulProductInvoiceToFiscalMetadata(item);
      const linkId = getProductInvoiceLinkId(item, index);
      await this.links?.upsertLink({
        target: "fiscal_document",
        localEntityId: `nfe:${linkId}`,
        remoteEntityId: metadata.accessKey,
        remoteDisplayId: metadata.number ?? metadata.accessKey,
        remoteEntityType: "conta_azul_nfe",
        metadata: {
          provider: this.provider,
          resource: "notas-fiscais",
          source: "fiscal_poll",
          fiscal: metadata,
        },
      });
      await this.syncFiscalXmlRemoteDocument({
        fiscalDocumentType: "nfe",
        localFiscalDocumentId: `nfe:${linkId}`,
        accessKey: metadata.accessKey,
        number: metadata.number,
      });
    }

    const totalItems = extractFiscalTotalItems(response);
    const nextPage =
      consumedItems.length < items.length ||
      hasNextFiscalPage({
        page: params.page,
        pageSize: params.pageSize,
        totalItems,
        pageItemCount: items.length,
      })
        ? params.page + 1
        : null;

    return {
      processedCount: consumedItems.length,
      updatedCount: consumedItems.length,
      nextPage,
    };
  }

  private async syncFiscalXmlRemoteDocument(params: {
    fiscalDocumentType: FiscalDocumentPollType;
    localFiscalDocumentId: string;
    accessKey: string | null;
    number: string | null;
  }) {
    if (!this.config.enabledTargets.remoteDocuments || !params.accessKey) {
      return;
    }

    const localEntityId = `${params.localFiscalDocumentId}:xml`;

    try {
      const xml = await this.client.getInvoiceByAccessKey(params.accessKey);

      await this.links?.upsertLink({
        target: "remote_document",
        localEntityId,
        remoteEntityId: `${params.accessKey}:xml`,
        remoteDisplayId: params.number
          ? `Nota fiscal ${params.number} XML`
          : `${params.accessKey} XML`,
        remoteEntityType: "conta_azul_fiscal_xml",
        metadata: {
          provider: this.provider,
          resource: "notas-fiscais/{chave}",
          source: "fiscal_poll",
          documentKind: "fiscal_xml",
          fiscalDocumentType: params.fiscalDocumentType,
          accessKey: params.accessKey,
          number: params.number,
          contentType: "application/xml",
          byteLength: new TextEncoder().encode(xml).byteLength,
          downloadableViaApi: true,
          status: "available",
          syncedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      await this.links?.upsertLink({
        target: "remote_document",
        localEntityId,
        remoteEntityId: `${params.accessKey}:xml`,
        remoteDisplayId: params.number
          ? `Nota fiscal ${params.number} XML`
          : `${params.accessKey} XML`,
        remoteEntityType: "conta_azul_fiscal_xml",
        metadata: {
          provider: this.provider,
          resource: "notas-fiscais/{chave}",
          source: "fiscal_poll",
          documentKind: "fiscal_xml",
          fiscalDocumentType: params.fiscalDocumentType,
          accessKey: params.accessKey,
          number: params.number,
          downloadableViaApi: true,
          status: "unavailable",
          error: getSafeErrorMessage(error),
          syncedAt: new Date().toISOString(),
        },
      });
    }
  }

  private async pollServiceInvoices(params: {
    window: { start: Date; end: Date };
    page: number;
    pageSize: number;
    remainingLimit: number;
  }) {
    if (params.remainingLimit <= 0) {
      return { processedCount: 0, updatedCount: 0, nextPage: params.page };
    }

    const response =
      await this.client.searchServiceInvoices<ContaAzulServiceInvoiceSearchResponse>(
        {
          data_competencia_de: toDateOnly(params.window.start),
          data_competencia_ate: toDateOnly(params.window.end),
          pagina: params.page,
          tamanho_pagina: clampContaAzulPageSize(params.pageSize),
        },
      );
    const items = extractServiceInvoices(response);
    const consumedItems = items.slice(0, params.remainingLimit);

    for (const [index, item] of consumedItems.entries()) {
      const metadata = mapContaAzulServiceInvoiceToFiscalMetadata(item);
      const linkId = getServiceInvoiceLinkId(item, index);
      await this.links?.upsertLink({
        target: "fiscal_document",
        localEntityId: `nfse:${linkId}`,
        remoteEntityId: metadata.remoteEntityId,
        remoteDisplayId: metadata.number ?? metadata.remoteEntityId,
        remoteEntityType: "conta_azul_nfse",
        metadata: {
          provider: this.provider,
          resource: "notas-fiscais-servico",
          source: "fiscal_poll",
          fiscal: metadata,
        },
      });
    }

    const totalItems = extractFiscalTotalItems(response);
    const nextPage =
      consumedItems.length < items.length ||
      hasNextFiscalPage({
        page: params.page,
        pageSize: params.pageSize,
        totalItems,
        pageItemCount: items.length,
      })
        ? params.page + 1
        : null;

    return {
      processedCount: consumedItems.length,
      updatedCount: consumedItems.length,
      nextPage,
    };
  }
}

export function createFinancialErpAdapter(
  options: FinancialErpAdapterOptions,
): FinancialErpAdapter {
  if (options.provider === "generic_http") {
    return new GenericHttpFinancialErpAdapter(options);
  }

  return new ContaAzulFinancialErpAdapter(options);
}

export function normalizeAdapterConfig(
  provider: IntegrationProvider,
  config: FinancialErpConnectionConfig,
): FinancialErpConnectionConfig {
  if (provider === "conta_azul") {
    return normalizeContaAzulConnectionConfig(config);
  }

  return normalizeGenericFinancialErpConfig(config);
}
