import type { IntegrationsApi } from "../types";
import { readJsonResponse } from "../transport/response";

export function createIntegrationsApi(rawCloudClient: any): IntegrationsApi {
  return {
    async list<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations.$get(),
        "Falha ao carregar integrações",
      );
    },
    async create<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations.$post({ json: input }),
        "Falha ao criar integração",
      );
    },
    async startContaAzulOAuth<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations["conta-azul"].oauth.start.$post({
          json: input,
        }),
        "Falha ao iniciar OAuth da Conta Azul",
      );
    },
    async validate<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].validate.$post({
          param: { id },
        }),
        "Falha ao validar conexão",
      );
    },
    async update<TResponse = unknown>(id: string, input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].$put({
          param: { id },
          json: input,
        }),
        "Falha ao salvar mapeamento",
      );
    },
    async updateContaAzulConfig<TResponse = unknown>(
      id: string,
      input: unknown,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"].config.$put({
          param: { id },
          json: input,
        }),
        "Falha ao salvar configuração da Conta Azul",
      );
    },
    async listContaAzulCatalog<TResponse = unknown>(
      id: string,
      catalog:
        | "accounts"
        | "balances"
        | "categories"
        | "cost-centers"
        | "dre-categories"
        | "product-categories"
        | "product-cest"
        | "product-ecommerce-brands"
        | "product-ecommerce-categories"
        | "product-ncm"
        | "products"
        | "product-units"
        | "sellers"
        | "services"
        | "transfers",
    ) {
      const contaAzul = rawCloudClient.api.integrations[":id"]["conta-azul"];
      const endpoint =
        catalog === "accounts"
          ? contaAzul.catalog.accounts
          : catalog === "categories"
            ? contaAzul.catalog.categories
            : catalog === "cost-centers"
              ? contaAzul.catalog["cost-centers"]
              : contaAzul.catalog[":catalog"];

      return readJsonResponse<TResponse>(
        await endpoint.$get({
          param:
            catalog === "accounts" ||
            catalog === "categories" ||
            catalog === "cost-centers"
              ? { id }
              : { id, catalog },
        }),
        "Falha ao carregar catálogo da Conta Azul",
      );
    },
    async pollContaAzul<TResponse = unknown>(id: string, input?: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"].poll.$post({
          param: { id },
          json: input ?? {},
        }),
        "Falha ao consultar pagamentos da Conta Azul",
      );
    },
    async pollContaAzulFiscal<TResponse = unknown>(
      id: string,
      input?: unknown,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"][
          "poll-fiscal"
        ].$post({
          param: { id },
          json: input ?? {},
        }),
        "Falha ao consultar documentos fiscais da Conta Azul",
      );
    },
    async linkContaAzulInvoicesToMdfe<TResponse = unknown>(
      id: string,
      input: unknown,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"][
          "link-mdfe"
        ].$post({
          param: { id },
          json: input,
        }),
        "Falha ao vincular MDF-e na Conta Azul",
      );
    },
    async pollContaAzulPayables<TResponse = unknown>(
      id: string,
      input?: unknown,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"][
          "poll-payables"
        ].$post({
          param: { id },
          json: input ?? {},
        }),
        "Falha ao consultar contas a pagar da Conta Azul",
      );
    },
    async pollContaAzulProtocols<TResponse = unknown>(
      id: string,
      input?: unknown,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"][
          "poll-protocols"
        ].$post({
          param: { id },
          json: input ?? {},
        }),
        "Falha ao consultar protocolos da Conta Azul",
      );
    },
    async pollContaAzulDrift<TResponse = unknown>(id: string, input?: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"]["conta-azul"][
          "poll-drift"
        ].$post({
          param: { id },
          json: input ?? {},
        }),
        "Falha ao verificar drift da Conta Azul",
      );
    },
    async getContaAzulSchedule<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"][
          "conta-azul"
        ].schedule.$get({
          param: { id },
        }),
        "Falha ao carregar agenda da Conta Azul",
      );
    },
    async refreshContaAzul<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"][
          "conta-azul"
        ].refresh.$post({
          param: { id },
        }),
        "Falha ao renovar token da Conta Azul",
      );
    },
    async disconnectContaAzul<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"][
          "conta-azul"
        ].disconnect.$post({
          param: { id },
        }),
        "Falha ao desconectar Conta Azul",
      );
    },
    async toggle<TResponse = unknown>(id: string, input: { enabled: boolean }) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].toggle.$post({
          param: { id },
          json: input,
        }),
        "Falha ao atualizar status",
      );
    },
    async previewSync<TResponse = unknown>(id: string, input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].sync.preview.$post({
          param: { id },
          json: input,
        }),
        "Falha ao montar prévia",
      );
    },
    async sync<TResponse = unknown>(id: string, input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].sync.$post({
          param: { id },
          json: input,
        }),
        "Falha ao iniciar sync",
      );
    },
    async schedule<TResponse = unknown>(id: string, input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].schedule.$post({
          param: { id },
          json: input,
        }),
        "Falha ao atualizar agenda",
      );
    },
    async listRunItems<TResponse = unknown>(id: string, runId: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].runs[":runId"].items.$get({
          param: { id, runId },
        }),
        "Falha ao carregar itens da execução",
      );
    },
    async retryRun<TResponse = unknown>(id: string, runId: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations[":id"].runs[":runId"].retry.$post(
          {
            param: { id, runId },
          },
        ),
        "Falha ao reprocessar sync",
      );
    },
    async listDrift<TResponse = unknown>(input: { target?: string } = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations.drift.$get({
          query: { target: input.target || undefined },
        }),
        "Falha ao carregar fila de drift",
      );
    },
    async acknowledgeDrift<TResponse = unknown>(
      linkId: string,
      input: { reason: string },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.integrations.drift[":linkId"].acknowledge.$post(
          {
            param: { linkId },
            json: input,
          },
        ),
        "Falha ao marcar drift como resolvido",
      );
    },
  };
}
