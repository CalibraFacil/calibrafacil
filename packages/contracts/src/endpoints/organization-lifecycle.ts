import { z } from "zod";
import { SoftDeleteOrganizationSchema } from "@calibra-facil/schemas";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's lifecycle (records retention): the owner
 * soft-deletes it, its records are kept for the retention period and it is
 * locked. The response schema is the wire body of
 * `apps/api/src/domains/org/routes/organization-lifecycle.ts`. Cloud-only.
 */

export const organizationLifecycleEndpoints = {
  softDelete: endpoint({
    method: "post",
    path: "/api/organization/soft-delete",
    body: SoftDeleteOrganizationSchema,
    response: z.object({ success: z.literal(true), deletedAt: z.string() }),
    failure: "Falha ao excluir a organização",
    policy: "cloud-only",
    desktopLabel: "Exclusão da organização",
  }),
} as const satisfies EndpointGroup;

export type SoftDeleteOrganizationResponse = z.infer<
  (typeof organizationLifecycleEndpoints)["softDelete"]["response"]
>;
