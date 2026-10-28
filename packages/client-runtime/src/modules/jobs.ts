import {
  effectiveEnvironmentalLimitsResponseSchema,
  jobAmendResponseSchema,
  jobCreateResponseSchema,
  jobDetailSchema,
  jobDownloadUrlResponseSchema,
  jobFlagOotResponseSchema,
  jobGenerateLabelResponseSchema,
  jobMutationResponseSchema,
  jobTechniciansResponseSchema,
  jobWithdrawCertificateResponseSchema,
  jobsListResponseSchema,
  standardsListResponseSchema,
  type JobStatus,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import type { CreateJobInput, JobsApi, JobsListInput } from "../types";
import type { JobExecutionPayload } from "../jobs";
import { CalibraApiError } from "../transport/errors";
import { createValidatedReader, readApiError } from "../transport/response";
import { apiRouteParam } from "../transport/url";

type JobIdParam = { param: { id: string } };
type JobPostRoute<TInput> = { $post(input: TInput): Promise<Response> };

/**
 * The slice of the raw Hono RPC client this module drives. Declared here (not
 * `any`) so a renamed route or a changed payload fails `check-types`.
 */
export type JobsRawCloudClient = {
  api: {
    jobs: {
      $post(input: { json: CreateJobInput }): Promise<Response>;
      $get(input: {
        query: {
          page: string;
          limit: string;
          customerId?: string;
          query?: string;
          status?: JobStatus;
        };
      }): Promise<Response>;
      technicians: { list: { $get(): Promise<Response> } };
      ":id": {
        $get(input: JobIdParam): Promise<Response>;
        $delete(
          input: JobIdParam & { json: { reason: string } },
        ): Promise<Response>;
        approve: JobPostRoute<
          JobIdParam & {
            json: {
              reason?: string;
              environmentalJustification?: string;
              scopeOverrideJustification?: string;
            };
          }
        >;
        reject: JobPostRoute<JobIdParam & { json: { reason: string } }>;
        "retry-render": JobPostRoute<JobIdParam>;
        "flag-oot": JobPostRoute<
          JobIdParam & {
            json: {
              description?: string;
              affectedScope?: string;
              notifyCustomer: boolean;
            };
          }
        >;
        assign: JobPostRoute<JobIdParam & { json: { technicianId: string } }>;
        download: { $get(input: JobIdParam): Promise<Response> };
        "generate-label": JobPostRoute<JobIdParam>;
        "download-label": { $get(input: JobIdParam): Promise<Response> };
        "label-commands": {
          $get(
            input: JobIdParam & { query: Record<string, string> },
          ): Promise<Response>;
        };
        amend: JobPostRoute<JobIdParam & { json: { reason: string } }>;
        certificate: {
          withdraw: JobPostRoute<JobIdParam & { json: { reason: string } }>;
        };
        execute: JobPostRoute<JobIdParam & { json: JobExecutionPayload }>;
        submit: JobPostRoute<JobIdParam & { json: JobExecutionPayload }>;
      };
    };
    standards: {
      $get(input: {
        query: { status?: string; limit?: string };
      }): Promise<Response>;
    };
    "environmental-limits": {
      effective: {
        ":assetTypeId": {
          $get(input: {
            param: { assetTypeId: string };
            query?: { unitId?: string };
          }): Promise<Response>;
        };
      };
    };
  };
};

export function createJobsApi(
  rawCloudClient: JobsRawCloudClient,
  options: ResponseValidationOptions = {},
): JobsApi {
  // Every contract-covered response below is checked against its
  // `@calibra-facil/contracts` schema; see `validateResponsePayload` for the
  // strict (dev/test) vs warn (production) behavior on a mismatch.
  const validated = createValidatedReader(options);

  return {
    async list(input: JobsListInput) {
      return validated(
        await rawCloudClient.api.jobs.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            customerId: input.customerId ? String(input.customerId) : undefined,
            query: input.query || undefined,
            status: input.status || undefined,
          },
        }),
        jobsListResponseSchema,
        "GET /api/jobs",
        "Falha ao carregar calibrações",
      );
    },
    async create(input: CreateJobInput) {
      return validated(
        await rawCloudClient.api.jobs.$post({ json: input }),
        jobCreateResponseSchema,
        "POST /api/jobs",
        "Erro ao criar ordem",
      );
    },
    async get(jobId: string | number) {
      return validated(
        await rawCloudClient.api.jobs[":id"].$get({
          param: { id: apiRouteParam(jobId) },
        }),
        jobDetailSchema,
        "GET /api/jobs/:id",
        "Falha ao carregar job",
      );
    },
    async listTechnicians() {
      return validated(
        await rawCloudClient.api.jobs.technicians.list.$get(),
        jobTechniciansResponseSchema,
        "GET /api/jobs/technicians/list",
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
      return validated(
        await rawCloudClient.api.jobs[":id"].approve.$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        jobMutationResponseSchema,
        "POST /api/jobs/:id/approve",
        "Erro ao aprovar",
      );
    },
    async reject(jobId: string | number, reason: string) {
      return validated(
        await rawCloudClient.api.jobs[":id"].reject.$post({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        jobMutationResponseSchema,
        "POST /api/jobs/:id/reject",
        "Erro ao rejeitar",
      );
    },
    async retryRender(jobId: string | number) {
      return validated(
        await rawCloudClient.api.jobs[":id"]["retry-render"].$post({
          param: { id: apiRouteParam(jobId) },
        }),
        jobMutationResponseSchema,
        "POST /api/jobs/:id/retry-render",
        "Erro ao reemitir o certificado",
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
      return validated(
        await rawCloudClient.api.jobs[":id"]["flag-oot"].$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        jobFlagOotResponseSchema,
        "POST /api/jobs/:id/flag-oot",
        "Erro ao registrar fora de tolerância",
      );
    },
    async cancel(jobId: string | number, reason: string) {
      return validated(
        await rawCloudClient.api.jobs[":id"].$delete({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        jobMutationResponseSchema,
        "DELETE /api/jobs/:id",
        "Erro ao cancelar",
      );
    },
    async assign(jobId: string | number, technicianId: string) {
      return validated(
        await rawCloudClient.api.jobs[":id"].assign.$post({
          param: { id: apiRouteParam(jobId) },
          json: { technicianId },
        }),
        jobMutationResponseSchema,
        "POST /api/jobs/:id/assign",
        "Erro ao atribuir",
      );
    },
    async listStandards() {
      return validated(
        await rawCloudClient.api.standards.$get({
          query: { status: "ACTIVE", limit: "100" },
        }),
        standardsListResponseSchema,
        "GET /api/standards",
        "Falha ao carregar padrões",
      );
    },
    async getEffectiveEnvironmentalLimits(
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

      return validated(
        response,
        effectiveEnvironmentalLimitsResponseSchema,
        "GET /api/environmental-limits/effective/:assetTypeId",
        "Falha ao carregar limites ambientais",
      );
    },
    async saveExecution(jobId: string | number, input: JobExecutionPayload) {
      return validated(
        await rawCloudClient.api.jobs[":id"].execute.$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        jobMutationResponseSchema,
        "POST /api/jobs/:id/execute",
        "Erro ao salvar",
      );
    },
    async submitExecution(jobId: string | number, input: JobExecutionPayload) {
      return validated(
        await rawCloudClient.api.jobs[":id"].submit.$post({
          param: { id: apiRouteParam(jobId) },
          json: input,
        }),
        jobMutationResponseSchema,
        "POST /api/jobs/:id/submit",
        "Erro ao submeter",
      );
    },
    async getCertificateDownloadUrl(jobId: string | number) {
      return validated(
        await rawCloudClient.api.jobs[":id"].download.$get({
          param: { id: apiRouteParam(jobId) },
        }),
        jobDownloadUrlResponseSchema,
        "GET /api/jobs/:id/download",
        "Falha ao gerar link",
      );
    },
    async generateLabel(jobId: string | number) {
      return validated(
        await rawCloudClient.api.jobs[":id"]["generate-label"].$post({
          param: { id: apiRouteParam(jobId) },
        }),
        jobGenerateLabelResponseSchema,
        "POST /api/jobs/:id/generate-label",
        "Falha ao gerar etiqueta",
      );
    },
    async getLabelDownloadUrl(jobId: string | number) {
      return validated(
        await rawCloudClient.api.jobs[":id"]["download-label"].$get({
          param: { id: apiRouteParam(jobId) },
        }),
        jobDownloadUrlResponseSchema,
        "GET /api/jobs/:id/download-label",
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
      return validated(
        await rawCloudClient.api.jobs[":id"].amend.$post({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        jobAmendResponseSchema,
        "POST /api/jobs/:id/amend",
        "Falha ao criar retificação",
      );
    },
    async withdrawCertificate(jobId: string | number, reason: string) {
      return validated(
        await rawCloudClient.api.jobs[":id"].certificate.withdraw.$post({
          param: { id: apiRouteParam(jobId) },
          json: { reason },
        }),
        jobWithdrawCertificateResponseSchema,
        "POST /api/jobs/:id/certificate/withdraw",
        "Falha ao retirar o certificado",
      );
    },
  };
}
