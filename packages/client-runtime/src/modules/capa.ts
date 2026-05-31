import type {
  CapaCloseInput,
  CapaCreateInput,
  CapaImplementInput,
  CapaListInput,
  CapaUpdateInput,
  CapaVerifyInput,
  CapasApi,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createCapasApi(rawCloudClient: any): CapasApi {
  return {
    async list<TResponse = unknown>(input: CapaListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
            status: input.status || undefined,
            severity: input.severity || undefined,
            category: input.category || undefined,
            source: input.source || undefined,
            type: input.type || undefined,
            responsibleId: input.responsibleId || undefined,
            overdue:
              input.overdue === undefined ? undefined : String(input.overdue),
          },
        }),
        "Falha ao carregar CAPAs",
      );
    },
    async summary<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa.summary.$get(),
        "Falha ao carregar resumo",
      );
    },
    async get<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa[":id"].$get({
          param: { id: String(id) },
        }),
        "CAPA não encontrada",
      );
    },
    async auditLog<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa[":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create<TResponse = unknown>(input: CapaCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa.$post({ json: input }),
        "Erro ao criar CAPA",
      );
    },
    async update<TResponse = unknown>(
      id: string | number,
      input: CapaUpdateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar CAPA",
      );
    },
    async implement<TResponse = unknown>(
      id: string | number,
      input: CapaImplementInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa[":id"].implement.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao implementar",
      );
    },
    async verify<TResponse = unknown>(
      id: string | number,
      input: CapaVerifyInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa[":id"].verify.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao verificar",
      );
    },
    async close<TResponse = unknown>(
      id: string | number,
      input: CapaCloseInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.capa[":id"].close.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao fechar CAPA",
      );
    },
  };
}
