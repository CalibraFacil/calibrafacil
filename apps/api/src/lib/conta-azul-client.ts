import { CONTA_AZUL_API_BASE_URL } from "@calibra-facil/shared";

// Conta Azul's OpenAPI specs restrict `tamanho_pagina` to this enum across
// every paginated endpoint. Requests outside the set are rejected with 400.
export const CONTA_AZUL_PAGE_SIZES = [
  10, 20, 50, 100, 200, 500, 1000,
] as const;

export type ContaAzulPageSize = (typeof CONTA_AZUL_PAGE_SIZES)[number];

// Snap an arbitrary positive integer to the largest allowed page size ≤ the
// request (clamping below 10 to 10 and above 1000 to 1000). Use this at every
// paginated call site that takes a dynamic page size from outside this file.
export function clampContaAzulPageSize(value: number): ContaAzulPageSize {
  let result: ContaAzulPageSize = CONTA_AZUL_PAGE_SIZES[0];
  for (const size of CONTA_AZUL_PAGE_SIZES) {
    if (value >= size) {
      result = size;
    }
  }
  return result;
}

type QueryValue = string | number | boolean | null | undefined;

type ContaAzulRequestOptions = {
  accept?: string;
  query?: Record<string, QueryValue | QueryValue[]>;
  json?: unknown;
};

export type ContaAzulPessoaTipo = "Física" | "Jurídica" | "Estrangeira";
export type ContaAzulPessoaPerfil = "Cliente" | "Fornecedor" | "Transportadora";

export type ContaAzulPessoaPayload = {
  ativo?: boolean;
  codigo?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  enderecos?: Array<{
    bairro?: string;
    cep?: string;
    cidade?: string;
    complemento?: string;
    estado?: string;
    logradouro?: string;
    numero?: string;
    pais?: string;
  }>;
  nome: string;
  perfis?: Array<{ tipo_perfil: ContaAzulPessoaPerfil }>;
  telefone_comercial?: string;
  tipo_pessoa: ContaAzulPessoaTipo;
};

export type ContaAzulPessoaSearchItem = {
  id?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  documento?: string | null;
  nome?: string | null;
  ativo?: boolean | null;
};

export type ContaAzulPessoaSearchResponse = {
  items?: ContaAzulPessoaSearchItem[];
  itens?: ContaAzulPessoaSearchItem[];
  totalItems?: number;
  itens_totais?: number;
};

export type ContaAzulProductPayload = {
  ativo?: boolean;
  categoria?: {
    id: string | number;
  };
  codigo_sku?: string;
  descricao?: string;
  estoque?: {
    valor_venda?: number;
  };
  fiscal?: {
    cest?: {
      id: string | number;
    };
    ncm?: {
      id: string | number;
    };
    origem?: string;
    tipo_produto?: string;
    unidade_medida?: {
      id: string | number;
    };
  };
  formato?: "SIMPLES" | "VARIACAO";
  id_centro_custo?: string;
  nome: string;
  status?: "ATIVO" | "INATIVO";
  unidade_medida?: {
    id: string | number;
  };
};

export type ContaAzulProductSearchItem = {
  id?: string | null;
  codigo_sku?: string | null;
  codigo?: string | null;
  nome?: string | null;
  status?: string | null;
};

export type ContaAzulProductSearchResponse = {
  items?: ContaAzulProductSearchItem[];
  itens?: ContaAzulProductSearchItem[];
  totalItems?: number;
  total_items?: number;
  itens_totais?: number;
};

// Catálogo de serviços (POST/PATCH /v1/servicos). Distinct from
// ContaAzulServiceInvoice* which models notas-fiscais-servico.
// Schema: https://developers.contaazul.com/_bundle/open-api-docs/open-api-service.yaml
export type ContaAzulServicoStatus = "ATIVO" | "INATIVO";
export type ContaAzulServicoTipo = "PRESTADO" | "TOMADO" | "AMBOS";

export type ContaAzulServicoPayload = {
  codigo?: string;
  custo?: number;
  descricao: string;
  preco?: number;
  status?: ContaAzulServicoStatus;
  tipo_servico?: ContaAzulServicoTipo;
};

export type ContaAzulServicoSearchItem = {
  id?: string | null;
  codigo?: string | null;
  descricao?: string | null;
  status?: string | null;
};

export type ContaAzulServicoSearchResponse = {
  items?: ContaAzulServicoSearchItem[];
  itens?: ContaAzulServicoSearchItem[];
  totalItems?: number;
  total_items?: number;
  itens_totais?: number;
};

export type ContaAzulReceivableEventCreate = {
  data_competencia: string;
  valor: number;
  observacao: string;
  descricao: string;
  contato: string;
  conta_financeira: string;
  rateio?: Array<{
    id_categoria: string;
    valor: number;
    rateio_centro_custo?: Array<{
      id_centro_custo: string;
      valor: number;
    }>;
  }>;
  condicao_pagamento: {
    parcelas: Array<{
      descricao: string;
      data_vencimento: string;
      nota: string;
      conta_financeira: string;
      detalhe_valor: {
        valor_bruto: number;
        valor_liquido?: number;
      };
    }>;
  };
};

export type ContaAzulPayableEventCreate = ContaAzulReceivableEventCreate;

export type ContaAzulPaymentMethod =
  | "DINHEIRO"
  | "CARTAO_CREDITO"
  | "BOLETO_BANCARIO"
  | "CARTAO_CREDITO_VIA_LINK"
  | "CHEQUE"
  | "CARTAO_DEBITO"
  | "TRANSFERENCIA_BANCARIA"
  | "DEPOSITO_BANCARIO"
  | "OUTRO"
  | "CARTEIRA_DIGITAL"
  | "CASHBACK"
  | "PIX"
  | "PIX_PAGAMENTO_INSTANTANEO"
  // PIX_COBRANCA is the financial-event/baixa spelling; COBRANCA_PIX is the
  // commercial (venda/contrato) spelling. LINK_PAGAMENTO is the commercial
  // payment-link value (vs CARTAO_CREDITO_VIA_LINK on the financial side).
  | "PIX_COBRANCA"
  | "COBRANCA_PIX"
  | "LINK_PAGAMENTO"
  | "DEBITO_AUTOMATICO"
  | "CREDITO_LOJA"
  | "CREDITO_VIRTUAL"
  | "PROGRAMA_FIDELIDADE"
  | "SEM_PAGAMENTO"
  | "VALE_ALIMENTACAO"
  | "VALE_COMBUSTIVEL"
  | "VALE_PRESENTE"
  | "VALE_REFEICAO";

export type ContaAzulAcquittancePayload = {
  data_pagamento: string;
  composicao_valor: {
    multa?: number;
    juros?: number;
    valor_bruto: number;
    desconto?: number;
    taxa?: number;
  };
  conta_financeira: string;
  metodo_pagamento?: ContaAzulPaymentMethod;
  observacao?: string;
  nsu?: string;
};

export type ContaAzulAcquittancePatchPayload =
  Partial<ContaAzulAcquittancePayload> & {
    versao: number;
  };

export type ContaAzulSaleStatus = "EM_ANDAMENTO" | "APROVADO";

export type ContaAzulCommercialItemPayload = {
  id: string;
  quantidade: number;
  descricao?: string;
  valor: number;
  valor_custo?: number;
};

export type ContaAzulSalePaymentConditionPayload = {
  tipo_pagamento?: ContaAzulPaymentMethod | string;
  id_conta_financeira?: string;
  opcao_condicao_pagamento: string;
  nsu?: string;
  parcelas: Array<{
    data_vencimento: string;
    valor: number;
    descricao?: string;
  }>;
};

export type ContaAzulSalePayload = {
  id_cliente: string;
  numero: number;
  situacao: ContaAzulSaleStatus;
  data_venda: string;
  id_categoria?: string;
  id_centro_custo?: string;
  id_vendedor?: string;
  observacoes?: string;
  observacoes_pagamento?: string;
  id_natureza_operacao?: string;
  itens: ContaAzulCommercialItemPayload[];
  condicao_pagamento: ContaAzulSalePaymentConditionPayload;
};

export type ContaAzulContractPayload = {
  id_cliente: string;
  data_emissao?: string;
  id_categoria?: string;
  id_centro_custo?: string;
  id_vendedor?: string;
  observacoes?: string;
  observacoes_pagamento?: string;
  termos: {
    tipo_frequencia: "MENSAL" | "ANUAL";
    tipo_expiracao: "DATA" | "NUNCA";
    data_inicio: string;
    data_fim?: string;
    intervalo_frequencia?: number;
    dia_emissao_venda?: number;
    numero: number;
  };
  composicao_de_valor?: {
    frete?: number;
    desconto?: {
      tipo: "PORCENTAGEM" | "VALOR" | string;
      valor: number;
    };
  };
  condicao_pagamento: {
    tipo_pagamento?: ContaAzulPaymentMethod | string;
    id_conta_financeira?: string;
    dia_vencimento: number;
    primeira_data_vencimento: string;
  };
  itens: Array<{
    id: string;
    quantidade: number;
    descricao?: string;
    valor: number;
    valor_custo?: number;
  }>;
};

export type ContaAzulSaleBatchDeletePayload = {
  ids: Array<string | number>;
};

export type ContaAzulMdfeLinkStatus = "AUTORIZADO" | "ENCERRADO" | "CANCELADO";

export type ContaAzulMdfeLinkPayload = {
  chaves_acesso: string[];
  identificador: string;
  status?: ContaAzulMdfeLinkStatus;
};

export type ContaAzulProductInvoiceStatus =
  | "EMITIDA"
  | "CORRIGIDA_SUCESSO"
  | string;

export type ContaAzulProductInvoice = {
  chave_acesso?: string | null;
  data_emissao?: string | null;
  nome_destinatario?: string | null;
  numero_nota?: number | string | null;
  status?: ContaAzulProductInvoiceStatus | null;
};

export type ContaAzulProductInvoiceSearchResponse = {
  itens?: ContaAzulProductInvoice[];
  paginacao?: {
    pagina_atual?: number;
    tamanho_pagina?: number;
    total_itens?: number;
    total_paginas?: number;
  };
};

export type ContaAzulServiceInvoiceStatus =
  | "PENDENTE"
  | "PRONTA_ENVIO"
  | "AGUARDANDO_RETORNO"
  | "EM_ESPERA"
  | "EMITINDO"
  | "EMITIDA"
  | "CANCELADA"
  | "FALHA"
  | "FALHA_CANCELAMENTO"
  | "CORRIGIDA_SUCESSO"
  | "AGUARDANDO_CORRECAO"
  | "FALHA_CORRECAO"
  | "DENEGADA"
  | "CANCELAMENTO_MANUAL"
  | string;

export type ContaAzulServiceInvoice = {
  cidade_emissao?: {
    estado?: string | null;
    nome?: string | null;
  } | null;
  codigo_cnae?: string | null;
  data_competencia?: string | null;
  documento_cliente?: string | null;
  escriturado_manualmente?: boolean | null;
  id?: string | null;
  id_contrato?: string | null;
  id_venda?: string | null;
  informacao_transmissao?: {
    data_inicio_cancelamento?: string | null;
    data_inicio_emissao?: string | null;
  } | null;
  informacoes_cancelamento?: {
    motivo?: string | null;
    usuario?: string | null;
  } | null;
  nome_cliente?: string | null;
  numero_nfse?: number | string | null;
  numero_rps?: number | string | null;
  numero_venda?: number | string | null;
  status?: ContaAzulServiceInvoiceStatus | null;
  valor_total_nfse?: number | null;
};

export type ContaAzulServiceInvoiceSearchResponse = {
  itens?: ContaAzulServiceInvoice[];
  paginacao?: {
    pagina_atual?: number;
    tamanho_pagina?: number;
    total_itens?: number;
    total_paginas?: number;
  };
};

export type ContaAzulBinaryResponse = {
  body: ArrayBuffer;
  contentType: string | null;
};

// The live API returns the async-event creation protocol as
// { protocolo, status, data_criacao }. `protocolId`/`createdAt` are the
// previously-assumed (documented) aliases, kept optional for back-compat.
export type ContaAzulProtocolResponse = {
  protocolo?: string;
  protocolId?: string;
  status: "PENDING" | "SUCCESS" | "ERROR" | string;
  data_criacao?: string;
  createdAt?: string;
};

export type ContaAzulProtocolStatusResponse = {
  id?: string | null;
  resposta?: string | null;
  status?: "PENDING" | "SUCCESS" | "ERROR" | string | null;
  evento_financeiro_id?: string | null;
};

export type ContaAzulInstallmentStatus =
  | "PENDENTE"
  | "QUITADO"
  | "CANCELADO"
  | "RENEGOCIADO"
  | "RECEBIDO_PARCIAL"
  | "ATRASADO"
  | "PERDIDO";

export type ContaAzulInstallment = {
  id: string;
  indice?: number | null;
  status: ContaAzulInstallmentStatus | string;
  status_traduzido?: ContaAzulInstallmentStatus | string | null;
  valor_pago?: number | null;
  pago?: number | null;
  total?: number | null;
  nao_pago?: number | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  data_alteracao?: string | null;
  descricao?: string | null;
  nota?: string | null;
  metodo_pagamento?: string | null;
  nsu?: string | null;
  evento?: {
    id?: string | null;
    referencia?: string | null;
  } | null;
};

export type ContaAzulReceivableSearchResponse = {
  items?: ContaAzulInstallment[];
  itens?: ContaAzulInstallment[];
  totalItems?: number;
  itens_totais?: number;
};

export type ContaAzulPayableSearchResponse = ContaAzulReceivableSearchResponse;

export type ContaAzulCatalogItem = {
  id: string;
  nome?: string | null;
  codigo?: string | null;
  descricao?: string | null;
  id_legado?: string | number | null;
  ativo?: boolean | null;
  status?: string | null;
  tipo?: string | null;
};

export type ContaAzulCatalogResponse = {
  items?: ContaAzulCatalogItem[];
  itens?: ContaAzulCatalogItem[];
  totalItems?: number;
  itens_totais?: number;
};

export type ContaAzulClientOptions = {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  minRequestIntervalMs?: number;
  retryDelayMs?: number;
  rateLimitKey?: string | null;
  onUnauthorized?: () => Promise<string | null>;
};

export class ContaAzulApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
  }) {
    super(params.message);
    this.name = "ContaAzulApiError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details ?? null;
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function appendQuery(
  url: URL,
  query: Record<string, QueryValue | QueryValue[]> | undefined,
) {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === null || item === undefined) continue;
      url.searchParams.append(key, String(item));
    }
  }
}

async function readResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  return text || null;
}

async function readSuccessResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ContaAzulApiError({
      status: response.status,
      code: "CONTA_AZUL_INVALID_RESPONSE",
      message: "Conta Azul respondeu sem JSON",
      details: null,
    });
  }

  const body: T = await response.json();
  return body;
}

async function readSuccessTextResponse(response: Response): Promise<string> {
  return response.text();
}

function readSuccessNoContentResponse(response: Response): null {
  if (response.status !== 204) {
    throw new ContaAzulApiError({
      status: response.status,
      code: "CONTA_AZUL_INVALID_RESPONSE",
      message: "Conta Azul respondeu com conteúdo inesperado",
      details: null,
    });
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractErrorCode(body: unknown, fallback: string) {
  if (!isRecord(body)) return fallback;

  if (typeof body.code === "string" && body.code.trim()) {
    return body.code.trim();
  }
  if (typeof body.error === "string" && body.error.trim()) {
    return body.error.trim();
  }

  return fallback;
}

function redactString(value: string) {
  return value
    .replace(/(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(
      /([?&](?:access_token|refresh_token|token)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b\d{44}\b/g, "[fiscal-key-redacted]")
    .replace(/\b\d{14}\b/g, "[cnpj-redacted]")
    .replace(/\b\d{11}\b/g, "[cpf-redacted]");
}

function extractErrorMessage(body: unknown, status: number) {
  if (typeof body === "string" && body.trim()) {
    return redactString(body.trim()).slice(0, 500);
  }
  if (isRecord(body)) {
    if (typeof body.message === "string" && body.message.trim()) {
      return redactString(body.message.trim()).slice(0, 500);
    }
    if (typeof body.error_description === "string") {
      return redactString(body.error_description.trim()).slice(0, 500);
    }
    if (typeof body.error === "string" && body.error.trim()) {
      return redactString(body.error.trim()).slice(0, 500);
    }
  }

  return `Conta Azul respondeu HTTP ${status}`;
}

function shouldRedactErrorKey(key: string) {
  const normalizedKey = key.toLowerCase();
  return (
    normalizedKey.includes("token") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("authorization") ||
    normalizedKey.includes("cpf") ||
    normalizedKey.includes("cnpj") ||
    normalizedKey.includes("document") ||
    normalizedKey.includes("chave_acesso") ||
    normalizedKey.includes("access_key") ||
    normalizedKey.includes("payload")
  );
}

function sanitizeErrorValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return redactString(value).slice(0, 500);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeErrorValue(item, depth + 1));
  }

  return sanitizeErrorRecord(value, depth);
}

function sanitizeErrorRecord(value: object, depth = 0): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = shouldRedactErrorKey(key)
      ? "[redacted]"
      : sanitizeErrorValue(item, depth + 1);
  }

  return sanitized;
}

function sanitizeErrorDetails(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") {
    return body === null
      ? null
      : {
          body:
            typeof body === "string" ? redactString(body).slice(0, 500) : body,
        };
  }

  if (Array.isArray(body)) {
    return {
      body: sanitizeErrorValue(body),
    };
  }

  return sanitizeErrorRecord(body);
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rateLimitStates = new Map<
  string,
  {
    lastStartedAt: number;
    ready: Promise<void>;
  }
>();

async function waitForRateLimit(
  key: string | null,
  minRequestIntervalMs: number,
) {
  if (!key || minRequestIntervalMs <= 0) return;

  let state = rateLimitStates.get(key);
  if (!state) {
    state = { lastStartedAt: 0, ready: Promise.resolve() };
    rateLimitStates.set(key, state);
  }

  const scheduled = state.ready.then(async () => {
    const delayMs = Math.max(
      0,
      state.lastStartedAt + minRequestIntervalMs - Date.now(),
    );
    await wait(delayMs);
    state.lastStartedAt = Date.now();
  });
  state.ready = scheduled.catch(() => {});

  await scheduled;
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

export class ContaAzulClient {
  private accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly minRequestIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly rateLimitKey: string | null;
  private readonly onUnauthorized?: () => Promise<string | null>;

  constructor(options: ContaAzulClientOptions) {
    this.accessToken = options.accessToken;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? CONTA_AZUL_API_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 110;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.rateLimitKey = options.rateLimitKey?.trim() || null;
    this.onUnauthorized = options.onUnauthorized;
  }

  async request<T>(
    method: string,
    path: string,
    options: ContaAzulRequestOptions = {},
  ): Promise<T> {
    let retryCount = 0;
    let refreshedAfterUnauthorized = false;

    while (true) {
      await waitForRateLimit(this.rateLimitKey, this.minRequestIntervalMs);
      const response = await this.fetchImpl(
        this.buildUrl(path, options.query),
        this.buildRequestInit(method, options.json, options.accept),
      );

      if (
        response.status === 401 &&
        this.onUnauthorized &&
        !refreshedAfterUnauthorized
      ) {
        const refreshedToken = await this.onUnauthorized();
        if (refreshedToken?.trim()) {
          this.accessToken = refreshedToken.trim();
          refreshedAfterUnauthorized = true;
          continue;
        }
      }

      if (isRetryableStatus(response.status) && retryCount < this.maxRetries) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("retry-after"),
        );
        await wait(retryAfterMs ?? this.retryDelayMs * (retryCount + 1));
        retryCount += 1;
        continue;
      }

      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new ContaAzulApiError({
          status: response.status,
          code: extractErrorCode(body, "CONTA_AZUL_API_ERROR"),
          message: extractErrorMessage(body, response.status),
          details: sanitizeErrorDetails(body),
        });
      }

      return readSuccessResponse<T>(response);
    }
  }

  async requestBinary(
    method: string,
    path: string,
    options: ContaAzulRequestOptions = {},
  ): Promise<ContaAzulBinaryResponse> {
    let retryCount = 0;
    let refreshedAfterUnauthorized = false;

    while (true) {
      await waitForRateLimit(this.rateLimitKey, this.minRequestIntervalMs);
      const response = await this.fetchImpl(
        this.buildUrl(path, options.query),
        this.buildRequestInit(method, options.json, options.accept),
      );

      if (
        response.status === 401 &&
        this.onUnauthorized &&
        !refreshedAfterUnauthorized
      ) {
        const refreshedToken = await this.onUnauthorized();
        if (refreshedToken?.trim()) {
          this.accessToken = refreshedToken.trim();
          refreshedAfterUnauthorized = true;
          continue;
        }
      }

      if (isRetryableStatus(response.status) && retryCount < this.maxRetries) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("retry-after"),
        );
        await wait(retryAfterMs ?? this.retryDelayMs * (retryCount + 1));
        retryCount += 1;
        continue;
      }

      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new ContaAzulApiError({
          status: response.status,
          code: extractErrorCode(body, "CONTA_AZUL_API_ERROR"),
          message: extractErrorMessage(body, response.status),
          details: sanitizeErrorDetails(body),
        });
      }

      return {
        body: await response.arrayBuffer(),
        contentType: response.headers.get("content-type"),
      };
    }
  }

  async requestText(
    method: string,
    path: string,
    options: ContaAzulRequestOptions = {},
  ): Promise<string> {
    let retryCount = 0;
    let refreshedAfterUnauthorized = false;

    while (true) {
      await waitForRateLimit(this.rateLimitKey, this.minRequestIntervalMs);
      const response = await this.fetchImpl(
        this.buildUrl(path, options.query),
        this.buildRequestInit(method, options.json, options.accept),
      );

      if (
        response.status === 401 &&
        this.onUnauthorized &&
        !refreshedAfterUnauthorized
      ) {
        const refreshedToken = await this.onUnauthorized();
        if (refreshedToken?.trim()) {
          this.accessToken = refreshedToken.trim();
          refreshedAfterUnauthorized = true;
          continue;
        }
      }

      if (isRetryableStatus(response.status) && retryCount < this.maxRetries) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("retry-after"),
        );
        await wait(retryAfterMs ?? this.retryDelayMs * (retryCount + 1));
        retryCount += 1;
        continue;
      }

      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new ContaAzulApiError({
          status: response.status,
          code: extractErrorCode(body, "CONTA_AZUL_API_ERROR"),
          message: extractErrorMessage(body, response.status),
          details: sanitizeErrorDetails(body),
        });
      }

      return readSuccessTextResponse(response);
    }
  }

  async requestNoContent(
    method: string,
    path: string,
    options: ContaAzulRequestOptions = {},
  ): Promise<null> {
    let retryCount = 0;
    let refreshedAfterUnauthorized = false;

    while (true) {
      await waitForRateLimit(this.rateLimitKey, this.minRequestIntervalMs);
      const response = await this.fetchImpl(
        this.buildUrl(path, options.query),
        this.buildRequestInit(method, options.json, options.accept),
      );

      if (
        response.status === 401 &&
        this.onUnauthorized &&
        !refreshedAfterUnauthorized
      ) {
        const refreshedToken = await this.onUnauthorized();
        if (refreshedToken?.trim()) {
          this.accessToken = refreshedToken.trim();
          refreshedAfterUnauthorized = true;
          continue;
        }
      }

      if (isRetryableStatus(response.status) && retryCount < this.maxRetries) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("retry-after"),
        );
        await wait(retryAfterMs ?? this.retryDelayMs * (retryCount + 1));
        retryCount += 1;
        continue;
      }

      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new ContaAzulApiError({
          status: response.status,
          code: extractErrorCode(body, "CONTA_AZUL_API_ERROR"),
          message: extractErrorMessage(body, response.status),
          details: sanitizeErrorDetails(body),
        });
      }

      return readSuccessNoContentResponse(response);
    }
  }

  getPessoa<T = unknown>(id: string) {
    return this.request<T>("GET", `/v1/pessoas/${encodeURIComponent(id)}`);
  }

  searchPessoas<T = unknown>(query: Record<string, QueryValue | QueryValue[]>) {
    return this.request<T>("GET", "/v1/pessoas", { query });
  }

  createPessoa<T = unknown>(payload: ContaAzulPessoaPayload) {
    return this.request<T>("POST", "/v1/pessoas", { json: payload });
  }

  patchPessoa(id: string, payload: Partial<ContaAzulPessoaPayload>) {
    // Per Conta Azul docs (PATCH /v1/pessoas/{id}) the success response is 204
    // No Content — the request helper that expects JSON would either throw
    // "respondeu sem JSON" or return {} (which then trips "não retornou id
    // remoto" downstream). Use the no-content variant; the caller already
    // knows the remote id it just patched.
    return this.requestNoContent(
      "PATCH",
      `/v1/pessoas/${encodeURIComponent(id)}`,
      { json: payload },
    );
  }

  searchProducts<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]>,
  ) {
    return this.request<T>("GET", "/v1/produtos", { query });
  }

  getProduct<T = unknown>(id: string) {
    return this.request<T>("GET", `/v1/produtos/${encodeURIComponent(id)}`);
  }

  createProduct<T = unknown>(payload: ContaAzulProductPayload) {
    return this.request<T>("POST", "/v1/produtos", { json: payload });
  }

  patchProduct(id: string, payload: Partial<ContaAzulProductPayload>) {
    // Same 204 No Content pattern as patchPessoa — the no-content helper
    // avoids the JSON-body assumption baked into request().
    return this.requestNoContent(
      "PATCH",
      `/v1/produtos/${encodeURIComponent(id)}`,
      { json: payload },
    );
  }

  searchServices<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/servicos", { query });
  }

  createServico<T = unknown>(payload: ContaAzulServicoPayload) {
    return this.request<T>("POST", "/v1/servicos", { json: payload });
  }

  patchServico(id: string, payload: Partial<ContaAzulServicoPayload>) {
    // PATCH /v1/servicos/{id} returns 204 No Content per the OpenAPI spec.
    return this.requestNoContent(
      "PATCH",
      `/v1/servicos/${encodeURIComponent(id)}`,
      { json: payload },
    );
  }

  listFinancialAccounts<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/conta-financeira", { query });
  }

  getFinancialAccountBalance<T = unknown>(accountId: string) {
    return this.request<T>(
      "GET",
      `/v1/conta-financeira/${encodeURIComponent(accountId)}/saldo-atual`,
    );
  }

  listFinancialTransfers<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/financeiro/transferencias", {
      query,
    });
  }

  listCategories<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/categorias", { query });
  }

  listDreCategories<T = unknown>() {
    return this.request<T>("GET", "/v1/financeiro/categorias-dre");
  }

  listCostCenters<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/centro-de-custo", { query });
  }

  listSellers<T = unknown>() {
    return this.request<T>("GET", "/v1/venda/vendedores");
  }

  getSale<T = unknown>(id: string | number) {
    return this.request<T>("GET", `/v1/venda/${encodeURIComponent(id)}`);
  }

  putSale<T = unknown>(
    id: string,
    payload: Partial<ContaAzulSalePayload> &
      Pick<
        ContaAzulSalePayload,
        "id_cliente" | "numero" | "data_venda" | "situacao"
      >,
  ) {
    return this.request<T>("PUT", `/v1/venda/${encodeURIComponent(id)}`, {
      json: payload,
    });
  }

  searchSales<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/venda/busca", { query });
  }

  createSale<T = unknown>(payload: ContaAzulSalePayload) {
    return this.request<T>("POST", "/v1/venda", { json: payload });
  }

  getSalePdf(id: string | number) {
    return this.requestBinary(
      "GET",
      `/v1/venda/${encodeURIComponent(id)}/imprimir`,
      {
        accept: "application/pdf",
      },
    );
  }

  deleteSalesBatch<T = unknown>(payload: ContaAzulSaleBatchDeletePayload) {
    return this.request<T>("POST", "/v1/venda/exclusao-lote", {
      json: payload,
    });
  }

  getSaleItems<T = unknown>(saleId: string | number) {
    return this.request<T>(
      "GET",
      `/v1/venda/${encodeURIComponent(saleId)}/itens`,
    );
  }

  getNextSaleNumber<T = number | null>() {
    return this.request<T>("GET", "/v1/venda/proximo-numero");
  }

  createContract<T = unknown>(payload: ContaAzulContractPayload) {
    return this.request<T>("POST", "/v1/contratos", { json: payload });
  }

  searchContracts<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/contratos", { query });
  }

  getNextContractNumber<T = number | null>() {
    return this.request<T>("GET", "/v1/contratos/proximo-numero");
  }

  searchProductInvoices<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]>,
  ) {
    return this.request<T>("GET", "/v1/notas-fiscais", { query });
  }

  searchServiceInvoices<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]>,
  ) {
    return this.request<T>("GET", "/v1/notas-fiscais-servico", { query });
  }

  getInvoiceByAccessKey(accessKey: string) {
    return this.requestText(
      "GET",
      `/v1/notas-fiscais/${encodeURIComponent(accessKey)}`,
      {
        accept: "application/xml",
      },
    );
  }

  linkInvoicesToMdfe(payload: ContaAzulMdfeLinkPayload) {
    return this.requestNoContent("POST", "/v1/notas-fiscais/vinculo-mdfe", {
      json: payload,
    });
  }

  listProductCategories<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/produtos/categorias", { query });
  }

  listProductEcommerceCategories<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/produtos/ecommerce-categorias", {
      query,
    });
  }

  listProductEcommerceBrands<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/produtos/ecommerce-marcas", {
      query,
    });
  }

  listProductCest<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/produtos/cest", { query });
  }

  listProductNcm<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/produtos/ncm", { query });
  }

  listProductUnits<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]> = {},
  ) {
    return this.request<T>("GET", "/v1/produtos/unidades-medida", { query });
  }

  createReceivableEvent<T = unknown>(payload: ContaAzulReceivableEventCreate) {
    return this.request<T>(
      "POST",
      "/v1/financeiro/eventos-financeiros/contas-a-receber",
      { json: payload },
    );
  }

  searchReceivableEvents<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]>,
  ) {
    return this.request<T>(
      "GET",
      "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar",
      { query },
    );
  }

  createPayableEvent<T = unknown>(payload: ContaAzulPayableEventCreate) {
    return this.request<T>(
      "POST",
      "/v1/financeiro/eventos-financeiros/contas-a-pagar",
      { json: payload },
    );
  }

  // The methods below — protocol polling and the parcela/baixa (acquittance)
  // surface — are NOT in any public OpenAPI spec at
  // https://developers.contaazul.com. Their request/response shapes
  // (including the `versao` field on PATCH baixa) were observed against a
  // live developer account and the integration is verified end-to-end in
  // `apps/api/src/lib/__tests__/conta-azul-client.spec.ts` and the
  // financial-erp-adapters tests. If Conta Azul changes these endpoints
  // unannounced, expect drift here first. Last verified: 2026-05-28.

  getProtocol<T = ContaAzulProtocolStatusResponse>(id: string) {
    return this.request<T>("GET", `/v1/protocolo/${encodeURIComponent(id)}`);
  }

  searchPayableEvents<T = unknown>(
    query: Record<string, QueryValue | QueryValue[]>,
  ) {
    return this.request<T>(
      "GET",
      "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar",
      { query },
    );
  }

  getInstallmentsByEventId<T = ContaAzulInstallment[]>(eventId: string) {
    return this.request<T>(
      "GET",
      `/v1/financeiro/eventos-financeiros/${encodeURIComponent(
        eventId,
      )}/parcelas`,
    );
  }

  getInstallment<T = ContaAzulInstallment>(id: string) {
    return this.request<T>(
      "GET",
      `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(id)}`,
    );
  }

  createAcquittance<T = unknown>(
    installmentId: string,
    payload: ContaAzulAcquittancePayload,
  ) {
    return this.request<T>(
      "POST",
      `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(
        installmentId,
      )}/baixa`,
      { json: payload },
    );
  }

  listInstallmentAcquittances<T = unknown>(installmentId: string) {
    return this.request<T>(
      "GET",
      `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(
        installmentId,
      )}/baixa`,
    );
  }

  patchAcquittance<T = unknown>(
    acquittanceId: string,
    payload: ContaAzulAcquittancePatchPayload,
  ) {
    return this.request<T>(
      "PATCH",
      `/v1/financeiro/eventos-financeiros/parcelas/baixa/${encodeURIComponent(
        acquittanceId,
      )}`,
      { json: payload },
    );
  }

  deleteAcquittance(acquittanceId: string) {
    // The baixa DELETE returns a 2xx with an empty, non-JSON body (observed
    // against the live API: not 204, no JSON). Use the text path so it neither
    // tries to parse JSON nor asserts a specific no-content status.
    return this.requestText(
      "DELETE",
      `/v1/financeiro/eventos-financeiros/parcelas/baixa/${encodeURIComponent(
        acquittanceId,
      )}`,
    );
  }

  getAcquittance<T = unknown>(acquittanceId: string) {
    return this.request<T>(
      "GET",
      `/v1/financeiro/eventos-financeiros/parcelas/baixa/${encodeURIComponent(
        acquittanceId,
      )}`,
    );
  }

  private buildUrl(
    path: string,
    query: Record<string, QueryValue | QueryValue[]> | undefined,
  ) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    appendQuery(url, query);
    return url;
  }

  private buildRequestInit(
    method: string,
    json: unknown,
    accept = "application/json",
  ): RequestInit {
    const headers = new Headers({
      Authorization: `Bearer ${this.accessToken}`,
      Accept: accept,
    });

    const init: RequestInit = {
      method,
      headers,
    };

    if (json !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(json);
    }

    return init;
  }
}
