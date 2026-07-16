import type {
  CreateJobInput,
  CreateJobResult,
  JobAmendResult,
  JobDownloadUrlData,
  JobsApi,
  JobsListInput,
  TechnicianListData,
} from "../types";
import type {
  EffectiveEnvironmentalLimitsResponse,
  JobsListData,
  JobExecutionPayload,
  ReferenceStandardsResponse,
} from "../jobs";
import { CalibraApiError } from "../transport/errors";
import { readApiError, readJsonResponse } from "../transport/response";
import { apiRouteParam } from "../transport/url";

export function createJobsApi(rawCloudClient: any): JobsApi {
  return {
    async list(input: JobsListInput) {
      return readJsonResponse<JobsListData>(
        await rawCloudClient.api.jobs.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            customerId: input.customerId ? String(input.customerId) : undefined,
            query: input.query || undefined,
            status: input.status || undefined,
          },
        }),
        "Falha ao carregar calibrações",
      );
    },
    async create(input: CreateJobInput) {
      return readJsonResponse<CreateJobResult>(
        await rawCloudClient.api.jobs.$post({ json: input }),
        "Erro ao criar ordem",
      );
    },
    async get<TJob = unknown>(jobId: string | number) {
      return readJsonResponse<TJob>(
        await rawCloudClient.api.jobs[":id"].$get({
          param: { id: apiRouteParam(jobId) },
        }),
        "Falha ao carregar job",
      );
    },
    async listTechnicians() {
      return readJsonResponse<TechnicianListData>(
        await rawCloudClient.api.jobs.technicians.list.$get(),
        "Falha ao carregar técnicos",
      );
    },
    async approve(
      jobId: string | number,
      // Mirrors ApproveJobSchema: reason is optional approval notes.
      input: {
        reason?: string;
        environmentalJustification?: string;
        scopeOverrideJustification?: string;
      },
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"].approve.$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        "Erro ao aprovar",
      );
    },
    async reject(jobId: string | number, reason: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"].reject.$post({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        "Erro ao rejeitar",
      );
    },
    async flagOutOfTolerance(
      jobId: string | number,
      input: {
        description?: string;
        affectedScope?: string;
        notifyCustomer: boolean;
      },
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"]["flag-oot"].$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        "Erro ao registrar fora de tolerância",
      );
    },
    async cancel(jobId: string | number, reason: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"].$delete({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        "Erro ao cancelar",
      );
    },
    async assign(jobId: string | number, technicianId: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"].assign.$post({
          param: { id: apiRouteParam(jobId) },
          json: { technicianId },
        }),
        "Erro ao atribuir",
      );
    },
    async listStandards<TStandard = unknown>() {
      return readJsonResponse<ReferenceStandardsResponse<TStandard>>(
        await rawCloudClient.api.standards.$get({
          query: { status: "ACTIVE", limit: "100" },
        }),
        "Falha ao carregar padrões",
      );
    },
    async getEffectiveEnvironmentalLimits<TLimits = unknown>(
      assetTypeId: string | number,
      input: { unitId?: string | number | null } = {},
    ) {
      const response = await rawCloudClient.api[
        "environmental-limits"
      ].effective[":assetTypeId"].$get({
        param: { assetTypeId: String(assetTypeId) },
        query: input.unitId ? { unitId: String(input.unitId) } : undefined,
      });

      if (!response.ok) {
        return { limits: null, source: null };
      }

      const result: EffectiveEnvironmentalLimitsResponse<TLimits> =
        await response.json();
      return result;
    },
    async saveExecution(jobId: string | number, input: JobExecutionPayload) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"].execute.$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        "Erro ao salvar",
      );
    },
    async submitExecution(jobId: string | number, input: JobExecutionPayload) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"].submit.$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        "Erro ao submeter",
      );
    },
    async createCertificateDraft() {
      throw new Error(
        "Rascunhos locais de certificado estão disponíveis apenas no desktop",
      );
    },
    async getCertificateDownloadUrl(jobId: string | number) {
      return readJsonResponse<JobDownloadUrlData>(
        await rawCloudClient.api.jobs[":id"].download.$get({
          param: { id: apiRouteParam(jobId) },
        }),
        "Falha ao gerar link",
      );
    },
    async generateLabel(jobId: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.jobs[":id"]["generate-label"].$post({
          param: { id: apiRouteParam(jobId) },
        }),
        "Falha ao gerar etiqueta",
      );
    },
    async getLabelDownloadUrl(jobId: string | number) {
      return readJsonResponse<JobDownloadUrlData>(
        await rawCloudClient.api.jobs[":id"]["download-label"].$get({
          param: { id: apiRouteParam(jobId) },
        }),
        "Falha ao gerar link",
      );
    },
    async getLabelCommands(
      jobId: string | number,
      options?: { language?: "zpl" | "tspl"; dpi?: 203 | 300 },
    ) {
      const query: Record<string, string> = {};
      if (options?.language) query.lang = options.language;
      if (options?.dpi) query.dpi = String(options.dpi);
      const response: Response = await rawCloudClient.api.jobs[":id"][
        "label-commands"
      ].$get({
        param: { id: apiRouteParam(jobId) },
        query,
      });
      if (!response.ok) {
        throw new CalibraApiError(
          await readApiError(response, "Falha ao gerar comandos da etiqueta"),
          response.status,
          null,
        );
      }
      return response.text();
    },
    async amend(jobId: string | number, reason: string) {
      return readJsonResponse<JobAmendResult>(
        await rawCloudClient.api.jobs[":id"].amend.$post({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        "Falha ao criar retificação",
      );
    },
  };
}
