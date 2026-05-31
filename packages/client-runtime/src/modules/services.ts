import type {
  CreateServiceInput,
  ServiceAuditLogData,
  ServiceDetailData,
  ServicesApi,
  ServicesListData,
  ServicesListInput,
  UpdateServiceInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createServicesApi(rawCloudClient: any): ServicesApi {
  return {
    async list(input: ServicesListInput = {}) {
      return readJsonResponse<ServicesListData>(
        await rawCloudClient.api.services.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            query: input.query || undefined,
            assetTypeId: input.assetTypeId
              ? String(input.assetTypeId)
              : undefined,
            methodId: input.methodId ? String(input.methodId) : undefined,
            isActive:
              input.isActive === undefined ? undefined : String(input.isActive),
          },
        }),
        "Falha ao carregar serviços",
      );
    },
    async get(id: string | number) {
      return readJsonResponse<ServiceDetailData>(
        await rawCloudClient.api.services[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar serviço",
      );
    },
    async auditLog<TRecord = unknown>(id: string | number) {
      return readJsonResponse<ServiceAuditLogData<TRecord>>(
        await rawCloudClient.api.services[":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create(input: CreateServiceInput) {
      return readJsonResponse<{ id: number }>(
        await rawCloudClient.api.services.$post({ json: input }),
        "Erro ao criar serviço",
      );
    },
    async update(id: string | number, input: UpdateServiceInput) {
      return readJsonResponse<ServiceDetailData>(
        await rawCloudClient.api.services[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar serviço",
      );
    },
    async deactivate(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.services[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao desativar serviço",
      );
    },
  };
}
