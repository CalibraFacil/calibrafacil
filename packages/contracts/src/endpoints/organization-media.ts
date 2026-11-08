import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's logo (admin and owner). Response schemas are the wire bodies
 * of `apps/api/src/domains/org/routes/organization-media.ts`. Cloud-only. The upload is a
 * multipart form: the definition carries no `body` (the handler reads the form
 * itself) and the SDK overrides that method with the file upload
 * (`client-runtime/src/modules/organization-media.ts`).
 *
 * Not client-facing, so not defined here: `GET /logo/:key` (the image itself).
 */

const DESKTOP_LABEL = "Logo da organização";

export const organizationMediaEndpoints = {
  uploadLogo: endpoint({
    method: "post",
    path: "/api/organization-media/logo",
    response: z.object({ logoUrl: z.string() }),
    failure: "Falha ao enviar logo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
    permission: { organization: ["update"] },
  }),
  deleteLogo: endpoint({
    method: "delete",
    path: "/api/organization-media/logo",
    response: z.object({ logoUrl: z.null() }),
    failure: "Falha ao remover logo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
    permission: { organization: ["update"] },
  }),
} as const satisfies EndpointGroup;
