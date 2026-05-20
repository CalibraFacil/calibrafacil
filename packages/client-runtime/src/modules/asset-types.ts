import type { AssetTypesApi, AssetTypesListData } from "../types";
import { readJsonResponse } from "../transport/response";

export function createAssetTypesApi(rawCloudClient: any): AssetTypesApi {
  return {
    async list() {
      return readJsonResponse<AssetTypesListData>(
        await rawCloudClient.api["asset-types"].$get({ query: {} }),
        "Falha ao carregar tipos de instrumento",
      );
    },
  };
}
