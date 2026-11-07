import { z } from "zod";
import { parseCidr } from "@calibra-facil/shared/ip-range";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's public-API keys (admin and owner only). Response schemas are
 * wire schemas written from what `apps/api/src/routes/api-keys.ts` returns.
 * Cloud-only.
 */

export const API_KEY_SCOPES = [
  "customers:read",
  "customers:write",
  "assets:read",
  "assets:write",
  "requests:read",
  "requests:write",
  "jobs:read",
  "jobs:write",
  "services:read",
  "units:read",
  "reports:read",
  "certificates:read",
  "webhooks:manage",
] as const;

/** A key lives a year unless the laboratory asks for less (at most two years). */
export const DEFAULT_API_KEY_LIFETIME_DAYS = 365;
export const MAX_API_KEY_LIFETIME_DAYS = 730;

const allowedIpSchema = z
  .string()
  .trim()
  .refine((entry) => parseCidr(entry) !== null, {
    message: "Endereço IP ou faixa CIDR inválido",
  });

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(3).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(12).optional(),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_API_KEY_LIFETIME_DAYS)
    .default(DEFAULT_API_KEY_LIFETIME_DAYS),
  allowedIps: z.array(allowedIpSchema).max(20).optional(),
});

const apiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: nullableString,
  /** After this instant the key no longer works (null: a key made before expiry existed). */
  expiresAt: nullableString,
  /** Client addresses or CIDR ranges the key is accepted from (null: any). */
  allowedIps: z.array(z.string()).nullable(),
  createdAt: z.string(),
  revokedAt: nullableString,
});

/** GET /api/api-keys */
export const apiKeysListResponseSchema = z.object({
  data: z.array(apiKeySummarySchema),
});
export type ApiKeysListResponse = z.infer<typeof apiKeysListResponseSchema>;

/** POST /api/api-keys (201) and POST /api/api-keys/:id/rotate: the secret is shown once. */
export const apiKeySecretResponseSchema = z.object({
  secret: z.string(),
  key: apiKeySummarySchema.pick({
    id: true,
    name: true,
    keyPrefix: true,
    scopes: true,
    expiresAt: true,
    allowedIps: true,
  }),
});
export type ApiKeySecretResponse = z.infer<typeof apiKeySecretResponseSchema>;

const DESKTOP_LABEL = "API keys";

export const apiKeyEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/api-keys",
    response: apiKeysListResponseSchema,
    failure: "Falha ao carregar API keys",
    // The desktop shows an empty list (`desktop-client.ts`).
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/api-keys",
    body: CreateApiKeySchema,
    response: apiKeySecretResponseSchema,
    status: 201,
    failure: "Falha ao criar API key",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  rotate: endpoint({
    method: "post",
    path: "/api/api-keys/:id/rotate",
    response: apiKeySecretResponseSchema,
    failure: "Falha ao rotacionar API key",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  revoke: endpoint({
    method: "post",
    path: "/api/api-keys/:id/revoke",
    response: z.object({ success: z.literal(true) }),
    failure: "Falha ao revogar API key",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
