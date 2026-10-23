import { Hono } from "hono";
import { syncBootstrapPageRequestSchema } from "@calibra-facil/contracts";
import { domainErrorResponse, invalid } from "../../lib/domain-errors";
import { withLabPermission } from "../../middleware/permission";
import {
  buildBootstrapPageResponse,
  wantsBootstrapPages,
} from "../../modules/sync/bootstrap-pages";
import { buildLegacyBootstrapResponse } from "../../modules/sync/legacy-bootstrap";
import { type SyncRouterEnv, getMemberData } from "./env";

export const bootstrapRoutes = new Hono<SyncRouterEnv>().post(
  "/bootstrap",
  ...withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const session = c.get("session");
    const memberData = getMemberData(c);

    // Protocol 3 states itself in the body and gets the paged bootstrap
    // (modules/sync/bootstrap-pages.ts). A request without it (protocols 1 and 2) gets
    // the one unpaginated response below, exactly as before.
    const requestBody: unknown = await c.req.json().catch(() => null);
    if (wantsBootstrapPages(requestBody)) {
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
    }

    const response = await buildLegacyBootstrapResponse({
      user: session.user,
      member: memberData,
    });

    // DEPRECATED (protocols 1 and 2): one unpaginated response. Protocol 3 desktops use
    // POST /bootstrap/page. Delete with the legacy pull (see GET /pull).
    c.header("Deprecation", "true");
    return c.json(response);
  },
);
