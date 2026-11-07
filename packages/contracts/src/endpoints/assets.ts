import { z } from "zod";
import {
  AssetStatusSchema,
  CreateAssetSchema,
  ListAssetsQuerySchema,
  MeasurementUnitSchema,
  MetrologyRegimeSchema,
  UpdateAssetSchema,
} from "@calibra-facil/schemas";

import { nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The customers' instruments. Response schemas are wire schemas written from
 * what the handlers in `apps/api/src/domains/assets/routes/assets.ts` return; the desktop
 * local-server answers `list` and `get` (and the `create` stub) with the same
 * ones (`apps/local-server/src/contract.test.ts`). Fields the offline mirror
 * does not keep are optional.
 *
 * Not client-facing, so not defined here: `GET /search` (command palette),
 * `GET /:id/label` and `DELETE /:id`.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());

/** The stored asset: what POST /api/assets (201) and PUT /api/assets/:id answer with. */
export const assetRecordSchema = z.object({
  id: z.number(),
  customerId: z.number(),
  assetTypeId: z.number(),
  name: z.string(),
  manufacturer: nullableString,
  model: nullableString,
  serialNumber: z.string(),
  tag: z.string(),
  status: AssetStatusSchema,
  baseMeasurementUnit: MeasurementUnitSchema.nullable(),
  specifications: jsonRecordSchema.nullable(),
  lastCalibrationDate: nullableString,
  nextCalibrationDate: nullableString,
  comments: nullableString,
  metrologyRegime: MetrologyRegimeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetRecord = z.infer<typeof assetRecordSchema>;

/** An asset with its customer and type joined in, as the list and the detail show it. */
const assetSchema = assetRecordSchema.extend({
  customerName: z.string(),
  customerTaxId: nullableString,
  assetTypeName: z.string(),
  assetTypeSlug: nullableString,
  assetTypeDefinition: z.array(jsonRecordSchema).nullable(),
});

/** GET /api/assets */
export const assetsListResponseSchema = z.object({
  data: z.array(assetSchema),
  pagination: paginationSchema,
});
export type AssetsListResponse = z.infer<typeof assetsListResponseSchema>;

/** GET /api/assets/:id */
export const assetDetailSchema = assetSchema.extend({
  installedAt: nullableString,
  /** The regulation-fixed verification periodicity (legal metrology), opaque here. */
  regulatedInterval: jsonRecordSchema.nullable(),
  nextLegalVerificationDate: nullableString,
});
export type AssetDetail = z.infer<typeof assetDetailSchema>;

const assetAuditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedAt: z.string(),
  performedBy: z.string(),
  performerName: nullableString,
  ipAddress: nullableString,
  reason: nullableString,
});
export type AssetAuditLogEntry = z.infer<typeof assetAuditEntrySchema>;

export const assetEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/assets",
    query: ListAssetsQuerySchema,
    response: assetsListResponseSchema,
    failure: "Falha ao carregar ativos",
    policy: "local-first-read-through-sync",
  }),
  // The desktop creates a minimal asset stub offline and syncs it.
  create: endpoint({
    method: "post",
    path: "/api/assets",
    body: CreateAssetSchema,
    response: assetRecordSchema,
    status: 201,
    failure: "Erro ao criar ativo",
    policy: "local-command-sync",
  }),
  get: endpoint({
    method: "get",
    path: "/api/assets/:id",
    response: assetDetailSchema,
    failure: "Falha ao carregar ativo",
    policy: "local-first-read-through-sync",
  }),
  update: endpoint({
    method: "put",
    path: "/api/assets/:id",
    body: UpdateAssetSchema,
    response: assetRecordSchema,
    failure: "Erro ao atualizar ativo",
    policy: "cloud-only",
    desktopLabel: "Edição de ativos",
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/assets/:id/audit-log",
    response: z.object({ data: z.array(assetAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: "Edição de ativos",
  }),
} as const satisfies EndpointGroup;
