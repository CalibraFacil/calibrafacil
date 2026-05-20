import type {
  CalibrationRequestActionInput,
  CalibrationRequestConvertInput,
  CalibrationRequestsApi,
  CalibrationRequestsListInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createCalibrationRequestsApi(
  rawCloudClient: any,
): CalibrationRequestsApi {
  return {
    async list<TResponse = unknown>(input: CalibrationRequestsListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["calibration-requests"].$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
            status: input.status || undefined,
          },
        }),
        "Falha ao carregar solicitações",
      );
    },
    async get<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["calibration-requests"][":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar solicitação",
      );
    },
    async review<TResponse = unknown>(
      id: string | number,
      input: CalibrationRequestActionInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["calibration-requests"][":id"].review.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao revisar",
      );
    },
    async approve<TResponse = unknown>(
      id: string | number,
      input: CalibrationRequestActionInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["calibration-requests"][":id"].approve.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao aprovar",
      );
    },
    async reject<TResponse = unknown>(
      id: string | number,
      input: CalibrationRequestActionInput & { reason: string },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["calibration-requests"][":id"].reject.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao rejeitar",
      );
    },
    async convert<TResponse = unknown>(
      id: string | number,
      input: CalibrationRequestConvertInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["calibration-requests"][":id"].convert.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao converter",
      );
    },
  };
}
