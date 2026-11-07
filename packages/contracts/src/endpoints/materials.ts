import { z } from "zod";
import {
  AdjustMaterialStockSchema,
  CreateMaterialSchema,
  ListMaterialsQuerySchema,
  UpdateMaterialSchema,
} from "@calibra-facil/schemas";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The parts and materials catalog (pecas e materiais). Response schemas are wire
 * schemas written from what `apps/api/src/routes/materials.ts` returns.
 *
 * The catalog is cloud-only in v1: the desktop service-order flow keeps the
 * free-form part-item fallback (materialId stays null), and the desktop client
 * answers `list` with an empty page.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** One material (the list columns; `get`, `create` and `update` answer the whole row, which adds the unit and organization ids). */
const materialSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: nullableString,
  sku: nullableString,
  unit: z.string(),
  unitCostCents: nullableNumber,
  unitPriceCents: nullableNumber,
  controlsStock: z.boolean(),
  /** Read-mostly mirror of the ERP on-hand balance. */
  stockQuantity: nullableNumber,
  stockSyncedAt: nullableString,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaterialRecord = z.infer<typeof materialSchema>;

/** GET /api/materials */
export const materialsListResponseSchema = z.object({
  data: z.array(materialSchema),
  pagination: paginationSchema,
});
export type MaterialsListResponse = z.infer<typeof materialsListResponseSchema>;

/** POST /api/materials/:id/stock: the balance after the ERP adjust. */
const adjustMaterialStockResponseSchema = z.object({
  stockQuantity: z.number(),
  stockSyncedAt: z.string(),
});
export type AdjustMaterialStockResponse = z.infer<
  typeof adjustMaterialStockResponseSchema
>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Catálogo de materiais";

export const materialEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/materials",
    query: ListMaterialsQuerySchema,
    response: materialsListResponseSchema,
    failure: "Falha ao carregar materiais",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/materials/:id",
    params: z.object({ id: routeId }),
    response: materialSchema,
    failure: "Falha ao carregar material",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/materials",
    body: CreateMaterialSchema,
    response: materialSchema,
    status: 201,
    failure: "Erro ao criar material",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  update: endpoint({
    method: "put",
    path: "/api/materials/:id",
    params: z.object({ id: routeId }),
    body: UpdateMaterialSchema,
    response: materialSchema,
    failure: "Erro ao atualizar material",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  deactivate: endpoint({
    method: "delete",
    path: "/api/materials/:id",
    params: z.object({ id: routeId }),
    response: z.object({ message: z.string(), data: materialSchema }),
    failure: "Erro ao desativar material",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  adjustStock: endpoint({
    method: "post",
    path: "/api/materials/:id/stock",
    params: z.object({ id: routeId }),
    body: AdjustMaterialStockSchema,
    response: adjustMaterialStockResponseSchema,
    failure: "Erro ao ajustar estoque do material",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
