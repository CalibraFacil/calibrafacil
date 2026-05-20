import type {
  AssetAuditLogData,
  AssetDetailData,
  AssetsApi,
  AssetsListData,
  AssetsListInput,
  CreateAssetInput,
  UpdateAssetInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createAssetsApi(rawCloudClient: any): AssetsApi {
  return {
    async list(input: AssetsListInput) {
      return readJsonResponse<AssetsListData>(
        await rawCloudClient.api.assets.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            customerId: input.customerId ? String(input.customerId) : undefined,
            status: input.status || undefined,
            query: input.query || undefined,
          },
        }),
        "Falha ao carregar ativos",
      );
    },
    async create(input: CreateAssetInput) {
      return readJsonResponse<AssetsListData["data"][number]>(
        await rawCloudClient.api.assets.$post({ json: input }),
        "Erro ao criar ativo",
      );
    },
    async get<TAsset = AssetDetailData>(id: string | number) {
      return readJsonResponse<TAsset>(
        await rawCloudClient.api.assets[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar ativo",
      );
    },
    async update<TAsset = AssetDetailData>(
      id: string | number,
      input: UpdateAssetInput,
    ) {
      return readJsonResponse<TAsset>(
        await rawCloudClient.api.assets[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar ativo",
      );
    },
    async auditLog<TRecord = unknown>(id: string | number) {
      return readJsonResponse<AssetAuditLogData<TRecord>>(
        await rawCloudClient.api.assets[":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
  };
}
