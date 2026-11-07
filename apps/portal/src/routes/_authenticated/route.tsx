import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  getPortalSession,
  portalOrganization,
} from "@calibra-facil/auth/client";
import { sanitizePortalRedirect } from "@/lib/auth-redirect";
import { readSessionWithRetry } from "@calibra-facil/shared/session-retry";
import {
  loadPortalStartup,
  parsePortalSession,
} from "@/features/shell/portal-startup";
import { PortalLayout } from "@/features/shell/portal-layout";

async function readPortalSession() {
  const result = await readSessionWithRetry(getPortalSession);
  return { data: parsePortalSession(result.data) };
}

async function activatePortalOrganization(organizationId: string) {
  const result = await portalOrganization.setActive({ organizationId });
  // Plain copy on purpose: this runs in the route's beforeLoad, which is part
  // of the initial bundle graph, and the auth message catalog is not.
  if (result.error) {
    throw new Error("Falha ao ativar a organização");
  }
}

export const Route = createFileRoute("/_authenticated")({
  // Settle the session before any authenticated route renders (parity with
  // apps/web). The session, the client organizations and the lab branding are
  // requested together; the only dependent step is activating the right
  // organization, and only when the session does not already point at it. The
  // component below keeps its own session check as defense in depth for
  // sessions lost after load.
  beforeLoad: async ({ context, location, preload }) => {
    if (preload) return { startup: null };

    const startup = await loadPortalStartup({
      queryClient: context.queryClient,
      readSession: readPortalSession,
      setActiveOrganization: activatePortalOrganization,
    });

    if (startup.status === "signed-out") {
      throw redirect({
        to: "/sign-in",
        search: { redirect: sanitizePortalRedirect(location.href) },
      });
    }

    return { startup };
  },
  component: PortalLayoutRoute,
});

function PortalLayoutRoute() {
  const { startup } = Route.useRouteContext();

  return <PortalLayout startup={startup} />;
}
