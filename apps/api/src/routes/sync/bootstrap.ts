import { createRouter } from "../../server/router";
import { syncBootstrapPageRequestSchema } from "@calibra-facil/contracts";
import { domainErrorResponse, invalid } from "../../lib/domain-errors";
import { withLabPermission } from "../../middleware/permission";
import {
  buildBootstrapPageResponse,
  wantsBootstrapPages,
} from "../../modules/sync/bootstrap-pages";
import { updateRequiredBody } from "../../modules/sync/minimum-desktop-version";
import { type SyncRouterEnv, getMemberData } from "./env";

export const bootstrapRoutes = createRouter<SyncRouterEnv>().post(
  "/bootstrap",
  ...withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const session = c.get("session");
    const memberData = getMemberData(c);

    // The paged bootstrap (modules/sync/bootstrap-pages.ts). A request that does not
    // state protocol 3 or later in its body comes from a build that cannot read it (the
    // one unpaged response of protocols 1 and 2 is gone): it is told to update.
    const requestBody: unknown = await c.req.json().catch(() => null);
    if (!wantsBootstrapPages(requestBody)) {
      return c.json(updateRequiredBody(null), 426);
    }
    const request = syncBootstrapPageRequestSchema.safeParse(requestBody);
    const page = request.success
      ? await buildBootstrapPageResponse({
          user: session.user,
          member: memberData,
          request: request.data,
        })
      : null;
    if (!page) {
      return domainErrorResponse(
        c,
        invalid("invalid_request", "Requisição de bootstrap inválida."),
      );
    }
    return c.json(page);
  },
);
