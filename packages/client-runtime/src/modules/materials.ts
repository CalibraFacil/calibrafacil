import type {
  AdjustMaterialStockData,
  AdjustMaterialStockInput,
  CreateMaterialInput,
  MaterialDetailData,
  MaterialsApi,
  MaterialsListData,
  MaterialsListInput,
  UpdateMaterialInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createMaterialsApi(rawCloudClient: any): MaterialsApi {
  return {
    async list(input: MaterialsListInput = {}) {
      return readJsonResponse<MaterialsListData>(
        await rawCloudClient.api.materials.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            query: input.query || undefined,
            controlsStock:
              input.controlsStock === undefined
                ? undefined
                : String(input.controlsStock),
            isActive:
              input.isActive === undefined ? undefined : String(input.isActive),
          },
        }),
        "Falha ao carregar materiais",
      );
    },
    async get(id: string | number) {
      return readJsonResponse<MaterialDetailData>(
        await rawCloudClient.api.materials[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar material",
      );
    },
    async create(input: CreateMaterialInput) {
      return readJsonResponse<{ id: number }>(
        await rawCloudClient.api.materials.$post({ json: input }),
        "Erro ao criar material",
      );
    },
    async update(id: string | number, input: UpdateMaterialInput) {
      return readJsonResponse<MaterialDetailData>(
        await rawCloudClient.api.materials[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar material",
      );
    },
    async deactivate(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.materials[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao desativar material",
      );
    },
    async adjustStock(id: string | number, input: AdjustMaterialStockInput) {
      return readJsonResponse<AdjustMaterialStockData>(
        await rawCloudClient.api.materials[":id"].stock.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao ajustar estoque do material",
      );
    },
  };
}
