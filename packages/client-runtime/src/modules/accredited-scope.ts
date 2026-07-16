import type {
  AccreditedScopeApi,
  AccreditedScopeResponse,
  SaveAccreditedScopeLineInput,
  SaveAccreditedScopeLineResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createAccreditedScopeApi(
  rawCloudClient: any,
): AccreditedScopeApi {
  return {
    async list() {
      return readJsonResponse<AccreditedScopeResponse>(
        await rawCloudClient.api["accredited-scope"].$get(),
        "Falha ao carregar o escopo acreditado",
      );
    },
    async save(input: SaveAccreditedScopeLineInput) {
      return readJsonResponse<SaveAccreditedScopeLineResponse>(
        await rawCloudClient.api["accredited-scope"].$put({ json: input }),
        "Falha ao salvar",
      );
    },
    async delete(id: number) {
      return readJsonResponse<{ message: string }>(
        await rawCloudClient.api["accredited-scope"][":id"].$delete({
          param: { id: String(id) },
        }),
        "Falha ao remover",
      );
    },
  };
}
