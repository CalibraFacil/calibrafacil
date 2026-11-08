import { z } from "zod";
import {
  CreateServiceSchema,
  ListServicesQuerySchema,
  UpdateServiceSchema,
} from "@calibra-facil/schemas";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's commercial service catalog (what it sells, linked to the
 * technical method that executes it). Response schemas are wire schemas written
 * from what the handlers in `apps/api/src/domains/catalog/routes/services.ts` return. Every
 * endpoint is `cloud-only`: the desktop does not manage the catalog.
 *
 * Not client-facing, so not defined here: `GET /api/services/:id/label` (the web
 * builds its label from `get`).
 */

/** The stored service row (what a write answers with). */
const serviceRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: nullableString,
  methodId: nullableNumber,
  assetTypeId: nullableNumber,
  /** In cents; null for "sob consulta". */
  price: nullableNumber,
  currency: z.string(),
  /** Turnaround time in business days. */
  tat: nullableNumber,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A service with its method and asset type joined in, as the list and the detail show it. */
const serviceSchema = serviceRowSchema.extend({
  methodName: nullableString,
  methodVersion: nullableNumber,
  methodStatus: nullableString,
  assetTypeName: nullableString,
});
export type ServiceRecord = z.infer<typeof serviceSchema>;

/** GET /api/services */
const servicesListResponseSchema = z.object({
  data: z.array(serviceSchema),
  pagination: paginationSchema,
});
export type ServicesListResponse = z.infer<typeof servicesListResponseSchema>;

const serviceAuditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedAt: z.string(),
  performedBy: z.string(),
  performerName: nullableString,
  ipAddress: nullableString,
  reason: nullableString,
});
export type ServiceAuditLogEntry = z.infer<typeof serviceAuditEntrySchema>;

const DESKTOP_LABEL = "Catálogo de serviços";

export const serviceEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/services",
    query: ListServicesQuerySchema,
    response: servicesListResponseSchema,
    failure: "Falha ao carregar serviços",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { service: ["read"] },
  }),
  get: endpoint({
    method: "get",
    path: "/api/services/:id",
    response: serviceSchema,
    failure: "Falha ao carregar serviço",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { service: ["read"] },
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/services/:id/audit-log",
    response: z.object({ data: z.array(serviceAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { service: ["read"] },
  }),
  create: endpoint({
    method: "post",
    path: "/api/services",
    body: CreateServiceSchema,
    response: serviceRowSchema,
    status: 201,
    failure: "Erro ao criar serviço",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { service: ["create"] },
  }),
  update: endpoint({
    method: "put",
    path: "/api/services/:id",
    body: UpdateServiceSchema,
    response: serviceRowSchema,
    failure: "Erro ao atualizar serviço",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { service: ["update"] },
  }),
  // Soft delete: the service stays, inactive.
  deactivate: endpoint({
    method: "delete",
    path: "/api/services/:id",
    response: z.object({ message: z.string(), data: serviceRowSchema }),
    failure: "Erro ao desativar serviço",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { service: ["delete"] },
  }),
} as const satisfies EndpointGroup;
