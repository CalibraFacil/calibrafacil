import {
  AmendJobSchema,
  ApproveJobSchema,
  AssignTechnicianSchema,
  CancelJobSchema,
  CreateJobSchema,
  ExecuteJobSchema,
  FlagJobOutOfToleranceSchema,
  ListJobsQuerySchema,
  RejectJobSchema,
  SubmitForReviewSchema,
  WithdrawCertificateSchema,
} from "@calibra-facil/schemas";

import {
  jobAmendResponseSchema,
  jobCreateResponseSchema,
  jobDetailSchema,
  jobDownloadUrlResponseSchema,
  jobExecutionResponseSchema,
  jobFlagOotResponseSchema,
  jobGenerateLabelResponseSchema,
  jobMutationResponseSchema,
  jobTechniciansResponseSchema,
  jobWithdrawCertificateResponseSchema,
  jobsListResponseSchema,
} from "../jobs";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's calibration jobs. The response schemas are the wire schemas
 * of `../jobs.ts` (written from what `apps/api/src/routes/jobs.ts` returns; the
 * desktop local-server answers the reads and the execution saves with them, see
 * `apps/local-server/src/contract.test.ts`).
 *
 * `:id` is a job's numeric id or its job code (the API resolves both); the SDK
 * normalizes the code before it reaches the URL (`modules/jobs.ts`).
 *
 * Not defined here, because the SDK does not call them as endpoints: the command
 * palette search, the label line, the amendment chain, the audit log, the file
 * and label-file downloads, and the job edit (`PUT /:id`). `GET /:id/label-commands`
 * answers plain text (ZPL/TSPL), which the JSON endpoint client does not read:
 * the SDK method is hand-written.
 */

const DESKTOP_LABEL = "Jobs de calibração";

export const jobEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/jobs",
    query: ListJobsQuerySchema,
    response: jobsListResponseSchema,
    failure: "Falha ao carregar calibrações",
    policy: "local-first-read-through-sync",
  }),
  create: endpoint({
    method: "post",
    path: "/api/jobs",
    body: CreateJobSchema,
    response: jobCreateResponseSchema,
    status: 201,
    failure: "Erro ao criar ordem",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  // Static segment: registered before the `/:id` routes.
  listTechnicians: endpoint({
    method: "get",
    path: "/api/jobs/technicians/list",
    response: jobTechniciansResponseSchema,
    failure: "Falha ao carregar técnicos",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/jobs/:id",
    response: jobDetailSchema,
    failure: "Falha ao carregar job",
    policy: "local-first-read-through-sync",
  }),
  approve: endpoint({
    method: "post",
    path: "/api/jobs/:id/approve",
    body: ApproveJobSchema,
    response: jobMutationResponseSchema,
    failure: "Erro ao aprovar",
    policy: "cloud-only",
    desktopLabel: "Aprovação de job",
  }),
  reject: endpoint({
    method: "post",
    path: "/api/jobs/:id/reject",
    body: RejectJobSchema,
    response: jobMutationResponseSchema,
    failure: "Erro ao rejeitar",
    policy: "cloud-only",
    desktopLabel: "Rejeição de job",
  }),
  retryRender: endpoint({
    method: "post",
    path: "/api/jobs/:id/retry-render",
    response: jobMutationResponseSchema,
    failure: "Erro ao reemitir o certificado",
    policy: "cloud-only",
    desktopLabel: "Reemissão de certificado",
  }),
  cancel: endpoint({
    method: "delete",
    path: "/api/jobs/:id",
    body: CancelJobSchema,
    response: jobMutationResponseSchema,
    failure: "Erro ao cancelar",
    policy: "cloud-only",
    desktopLabel: "Cancelamento de job",
  }),
  assign: endpoint({
    method: "post",
    path: "/api/jobs/:id/assign",
    body: AssignTechnicianSchema,
    response: jobMutationResponseSchema,
    failure: "Erro ao atribuir",
    policy: "cloud-only",
    desktopLabel: "Atribuição de técnico",
  }),
  // The cloud answers its whole job row; the local server the common core
  // (`jobExecutionResponseSchema`), which both satisfy.
  saveExecution: endpoint({
    method: "post",
    path: "/api/jobs/:id/execute",
    body: ExecuteJobSchema,
    response: jobExecutionResponseSchema,
    failure: "Erro ao salvar",
    policy: "local-command-sync",
  }),
  submitExecution: endpoint({
    method: "post",
    path: "/api/jobs/:id/submit",
    body: SubmitForReviewSchema,
    response: jobExecutionResponseSchema,
    failure: "Erro ao submeter",
    policy: "local-command-sync",
  }),
  getCertificateDownloadUrl: endpoint({
    method: "get",
    path: "/api/jobs/:id/download",
    response: jobDownloadUrlResponseSchema,
    failure: "Falha ao gerar link",
    policy: "cloud-only",
    desktopLabel: "Download de certificado publicado",
  }),
  generateLabel: endpoint({
    method: "post",
    path: "/api/jobs/:id/generate-label",
    response: jobGenerateLabelResponseSchema,
    failure: "Falha ao gerar etiqueta",
    policy: "cloud-only",
    desktopLabel: "Geração de etiqueta publicada",
  }),
  getLabelDownloadUrl: endpoint({
    method: "get",
    path: "/api/jobs/:id/download-label",
    response: jobDownloadUrlResponseSchema,
    failure: "Falha ao gerar link",
    policy: "cloud-only",
    desktopLabel: "Download de etiqueta publicada",
  }),
  amend: endpoint({
    method: "post",
    path: "/api/jobs/:id/amend",
    body: AmendJobSchema,
    response: jobAmendResponseSchema,
    status: 201,
    failure: "Falha ao criar retificação",
    policy: "cloud-only",
    desktopLabel: "Retificação de certificado",
  }),
  withdrawCertificate: endpoint({
    method: "post",
    path: "/api/jobs/:id/certificate/withdraw",
    body: WithdrawCertificateSchema,
    response: jobWithdrawCertificateResponseSchema,
    failure: "Falha ao retirar o certificado",
    policy: "cloud-only",
    desktopLabel: "Retirada de certificado",
  }),
  flagOutOfTolerance: endpoint({
    method: "post",
    path: "/api/jobs/:id/flag-oot",
    body: FlagJobOutOfToleranceSchema,
    response: jobFlagOotResponseSchema,
    status: 201,
    failure: "Erro ao registrar fora de tolerância",
    policy: "cloud-only",
    desktopLabel: "Sinalização de fora de tolerância",
  }),
} as const satisfies EndpointGroup;
