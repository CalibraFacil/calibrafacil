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
import { readJsonResponse } from "../transport/response";
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
      input: { reason: string; environmentalJustification?: string },
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

      return response.json() as Promise<
        EffectiveEnvironmentalLimitsResponse<TLimits>
      >;
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
