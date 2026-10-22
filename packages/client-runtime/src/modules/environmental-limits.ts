import {
  deleteEnvironmentalLimitResponseSchema,
  environmentalLimitsResponseSchema,
  saveEnvironmentalLimitResponseSchema,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import type {
  EnvironmentalLimitsApi,
  SaveEnvironmentalLimitInput,
} from "../types";
import { createValidatedReader } from "../transport/response";

export function createEnvironmentalLimitsApi(
  rawCloudClient: any,
  options: ResponseValidationOptions = {},
): EnvironmentalLimitsApi {
  const validated = createValidatedReader(options);

  return {
    async list() {
      return validated(
        await rawCloudClient.api["environmental-limits"].$get(),
        environmentalLimitsResponseSchema,
        "GET /api/environmental-limits",
        "Falha ao carregar limites",
      );
    },
    async save(input: SaveEnvironmentalLimitInput) {
      return validated(
        await rawCloudClient.api["environmental-limits"].$put({ json: input }),
        saveEnvironmentalLimitResponseSchema,
        "PUT /api/environmental-limits",
        "Falha ao salvar",
      );
    },
    async delete(id: number) {
      return validated(
        await rawCloudClient.api["environmental-limits"][":id"].$delete({
          param: { id: String(id) },
        }),
        deleteEnvironmentalLimitResponseSchema,
        "DELETE /api/environmental-limits/:id",
        "Falha ao remover",
      );
    },
  };
}
