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
  };
}
