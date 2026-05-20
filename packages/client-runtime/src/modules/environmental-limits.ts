import type {
  EnvironmentalLimitsApi,
  EnvironmentalLimitsResponse,
  SaveEnvironmentalLimitInput,
  SaveEnvironmentalLimitResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createEnvironmentalLimitsApi(
  rawCloudClient: any,
): EnvironmentalLimitsApi {
  return {
    async list() {
      return readJsonResponse<EnvironmentalLimitsResponse>(
        await rawCloudClient.api["environmental-limits"].$get(),
        "Falha ao carregar limites",
      );
    },
    async save(input: SaveEnvironmentalLimitInput) {
      return readJsonResponse<SaveEnvironmentalLimitResponse>(
        await rawCloudClient.api["environmental-limits"].$put({ json: input }),
        "Falha ao salvar",
      );
    },
    async delete(id: number) {
      return readJsonResponse<{ message: string }>(
        await rawCloudClient.api["environmental-limits"][":id"].$delete({
          param: { id: String(id) },
        }),
        "Falha ao remover",
      );
    },
  };
}
