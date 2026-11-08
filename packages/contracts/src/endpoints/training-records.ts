import { z } from "zod";
import {
  CreateTrainingRecordSchema,
  ListTrainingRecordsQuerySchema,
  TrainingTypeSchema,
} from "@calibra-facil/schemas";
import { TRAINING_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * Training records (ISO/IEC 17025 6.2.3 training evidence). Response schemas
 * are wire schemas written from what
 * `apps/api/src/domains/quality/routes/training-records.ts` returns.
 *
 * Not client-facing, so not defined here: `GET /:id`, `PUT /:id`,
 * `POST /:id/complete` and `DELETE /:id` (nothing calls them).
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const trainingTypeSchema = TrainingTypeSchema;
export type TrainingType = z.infer<typeof trainingTypeSchema>;

const trainingStatusSchema = z.enum(TRAINING_STATUSES);

/** A whole `training_record` row (what the create answers and a competence detail embeds). */
export const trainingRecordRowSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  /** Null once the owning user was deleted (the record survives, migration 0083). */
  userId: nullableString,
  competenceId: nullableNumber,
  title: z.string(),
  type: trainingTypeSchema,
  status: trainingStatusSchema,
  provider: nullableString,
  description: nullableString,
  startDate: z.string(),
  endDate: nullableString,
  hoursCompleted: nullableNumber,
  certificateR2Key: nullableString,
  certificateFileName: nullableString,
  score: nullableNumber,
  passingScore: nullableNumber,
  passed: z.boolean().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: nullableString,
});
export type TrainingRecordRow = z.infer<typeof trainingRecordRowSchema>;

/** One row of GET /api/training-records. */
const trainingRecordListItemSchema = z.object({
  id: z.number(),
  userId: nullableString,
  userName: z.string(),
  competenceId: nullableNumber,
  title: z.string(),
  type: trainingTypeSchema,
  status: trainingStatusSchema,
  provider: nullableString,
  startDate: z.string(),
  endDate: nullableString,
  hoursCompleted: nullableNumber,
  score: nullableNumber,
  passingScore: nullableNumber,
  passed: z.boolean().nullable(),
  createdAt: z.string(),
});
export type TrainingRecordListItem = z.infer<
  typeof trainingRecordListItemSchema
>;

export const trainingRecordsListResponseSchema = z.object({
  data: z.array(trainingRecordListItemSchema),
  pagination: paginationSchema,
});
export type TrainingRecordsListResponse = z.infer<
  typeof trainingRecordsListResponseSchema
>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Registros de treinamento";

export const trainingRecordEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/training-records",
    query: ListTrainingRecordsQuerySchema,
    response: trainingRecordsListResponseSchema,
    failure: "Falha ao carregar treinamentos",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { competence: ["read"] },
  }),
  create: endpoint({
    method: "post",
    path: "/api/training-records",
    body: CreateTrainingRecordSchema,
    response: trainingRecordRowSchema,
    status: 201,
    failure: "Erro ao criar registro de treinamento",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { competence: ["create"] },
  }),
} as const satisfies EndpointGroup;
