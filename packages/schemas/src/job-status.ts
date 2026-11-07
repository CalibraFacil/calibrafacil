import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";
import { z } from "zod";

// Lives in its own module so job-transitions.ts can import it without a cycle
// through index.ts.
export const JobStatusSchema = z.enum([
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
  "RENDER_FAILED",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "SUPERSEDED",
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JOB_STATUS = defineStatusVocabulary(JobStatusSchema.options, {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  IN_PROGRESS: { label: "Em execução", tone: "info" },
  REVIEW: { label: "Em revisão", tone: "warning" },
  GENERATING_PDF: { label: "Gerando PDF", tone: "info" },
  RENDER_FAILED: { label: "Falha na emissão", tone: "critical" },
  APPROVED: { label: "Aprovado", tone: "ok" },
  REJECTED: { label: "Rejeitado", tone: "critical" },
  CANCELED: { label: "Cancelado", tone: "neutral" },
  SUPERSEDED: { label: "Retificado", tone: "neutral" },
});

/** Not yet released: the job can still change before a certificate exists. */
export const OPEN_JOB_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
] as const satisfies readonly JobStatus[];

/** Still in the laboratory's pipeline (open, or its certificate is being rendered). */
export const IN_FLIGHT_JOB_STATUSES = [
  ...OPEN_JOB_STATUSES,
  "GENERATING_PDF",
  "RENDER_FAILED",
] as const satisfies readonly JobStatus[];

/** A certificate was issued for the job (the current one, or one an amendment replaced). */
export const CERTIFICATE_ISSUED_JOB_STATUSES = [
  "APPROVED",
  "SUPERSEDED",
] as const satisfies readonly JobStatus[];
