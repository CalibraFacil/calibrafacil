import { z } from "zod";
import {
  CreateAssetSchema,
  CreateCalibrationRequestSchema,
  CreateJobSchema,
  UpdateJobSchema,
} from "@calibra-facil/schemas";

export const ListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
});

export const AssetCreatePublicSchema = CreateAssetSchema.extend({
  externalId: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
  customerExternalId: z.string().trim().optional(),
}).refine((value) => value.customerId || value.customerExternalId, {
  message: "Informe customerId ou customerExternalId",
  path: ["customerId"],
});

export const JobCreatePublicSchema = CreateJobSchema.extend({
  externalId: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
  assetExternalId: z.string().trim().optional(),
}).refine((value) => value.assetId || value.assetExternalId, {
  message: "Informe assetId ou assetExternalId",
  path: ["assetId"],
});

export const PublicCreateRequestSchema = CreateCalibrationRequestSchema.extend({
  externalId: z.string().trim().optional(),
  customerId: z.coerce.number().optional(),
  customerExternalId: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
  assetExternalIds: z.array(z.string().trim()).optional(),
  assetIds: z.array(z.coerce.number().min(1)).optional(),
})
  .omit({ assetIds: true })
  .extend({
    assetIds: z.array(z.coerce.number().min(1)).optional(),
  })
  .refine((value) => value.customerId || value.customerExternalId, {
    message: "Informe customerId ou customerExternalId",
    path: ["customerId"],
  })
  .refine(
    (value) => {
      const totalAssetIds =
        (value.assetIds?.length ?? 0) + (value.assetExternalIds?.length ?? 0);
      return totalAssetIds > 0;
    },
    {
      message: "Informe ao menos um ativo",
      path: ["assetIds"],
    },
  );

export const UpdateRequestPublicSchema = z.object({
  observations: z.string().trim().max(2000).optional(),
  requestedDueDate: z.string().datetime().nullable().optional(),
});

export const CancelRequestPublicSchema = z.object({
  reason: z.string().trim().min(3),
});

export const WebhookSubscriptionSchema = z.object({
  name: z.string().trim().min(3).max(80),
  targetUrl: z.string().url(),
  events: z
    .array(
      z.enum([
        "customer.created",
        "customer.updated",
        "customer.deleted",
        "asset.created",
        "asset.updated",
        "asset.deleted",
        "request.created",
        "request.updated",
        "request.submitted",
        "request.canceled",
        "job.created",
        "job.updated",
        "job.results_submitted",
        "job.approved",
        "job.canceled",
        "certificate.available",
      ]),
    )
    .min(1)
    .max(32),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const ReportQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "month"]).optional().default("30d"),
  unitIds: z.string().optional(),
});

/**
 * Public `PATCH /jobs/:id` edits plain fields only. `status` is deliberately
 * not editable here: the full JobStatus enum would let a `jobs:write` key set
 * APPROVED (or revive SUPERSEDED) with no approver and none of the release
 * gates. Every transition has its own endpoint (`/submit`, `/reject`,
 * `DELETE` to cancel) and approval is refused to API keys altogether.
 */
export const PublicUpdateJobSchema = UpdateJobSchema.omit({
  status: true,
}).extend({
  externalId: z.string().trim().optional(),
  status: z
    .never({
      message:
        "O status da OS não pode ser alterado por este endpoint; use as ações /submit, /reject ou DELETE",
    })
    .optional(),
});
