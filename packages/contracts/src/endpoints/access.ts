import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * What the signed-in member may do in the finance area. The response schema is
 * the wire body of `apps/api/src/domains/finance/routes/access.ts`. Cloud-only: the
 * desktop answers a fixed "no finance rights" (`desktop-client.ts`).
 */

/** GET /api/finance/access */
export const financeAccessResponseSchema = z.object({
  canReadFinancial: z.boolean(),
  canManageFinancial: z.boolean(),
  canExportFinancial: z.boolean(),
  role: z.string(),
});
export type FinanceAccessResponse = z.infer<typeof financeAccessResponseSchema>;

export const accessEndpoints = {
  getFinanceAccess: endpoint({
    method: "get",
    path: "/api/finance/access",
    response: financeAccessResponseSchema,
    failure: "Erro ao carregar acesso financeiro",
    policy: "cloud-only",
    desktopLabel: "Acesso financeiro",
  }),
} as const satisfies EndpointGroup;
