import { z } from "zod";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The signed-in user's avatar. Response schemas are the wire bodies of
 * `apps/api/src/routes/profile-media.ts`. Cloud-only. The upload is a
 * multipart form: the definition carries no `body` (the handler reads the form
 * itself) and the SDK overrides that method with the file upload
 * (`client-runtime/src/modules/profile-media.ts`).
 *
 * Not client-facing, so not defined here: `GET /avatar` (the image itself).
 */

const DESKTOP_LABEL = "Avatar";

export const profileMediaEndpoints = {
  uploadAvatar: endpoint({
    method: "post",
    path: "/api/profile-media/avatar",
    response: z.object({ imageUrl: z.string() }),
    failure: "Falha ao enviar avatar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
  deleteAvatar: endpoint({
    method: "delete",
    path: "/api/profile-media/avatar",
    response: z.object({ success: z.literal(true) }),
    failure: "Falha ao remover avatar",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    desktopFlavor: "cloud-sync",
  }),
} as const satisfies EndpointGroup;
