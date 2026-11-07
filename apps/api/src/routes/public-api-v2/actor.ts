import type { ClientIpContext } from "../../lib/client-ip";
import type { OrgActor } from "../../lib/org-context";
import { getPublicApiRequestIp } from "../../lib/public-api";
import type { ApiKeyAuthVariables } from "../../middleware/api-key-auth";

/**
 * The actor of a public API write: the key's creator is the accountable person
 * (the audit trail records them), with the address the request came from.
 * What the lab's routes get from `requestActor(c)` (the signed-in user).
 */
export function apiKeyActor(
  apiKey: ApiKeyAuthVariables["apiKey"],
  c: ClientIpContext,
): OrgActor {
  return {
    userId: apiKey.createdBy,
    ipAddress: getPublicApiRequestIp(c),
    userAgent: c.req.header("user-agent") ?? null,
  };
}
