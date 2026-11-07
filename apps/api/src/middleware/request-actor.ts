import { clientIp, type ClientIpContext } from "../lib/client-ip";
import type { OrgActor } from "../lib/org-context";

/** The signed-in user of a request, as the actor of the changes it makes. */
export function requestActor(
  c: ClientIpContext & { get(key: "session"): { user: { id: string } } },
): OrgActor {
  return {
    userId: c.get("session").user.id,
    ipAddress: clientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
  };
}
