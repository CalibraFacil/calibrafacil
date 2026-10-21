import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { prefetchBranding } from "@/features/branding/queries";
import { getApiBaseUrl } from "@/lib/utils";

/**
 * Authenticated portal startup.
 *
 * The session, the user's client organizations and the lab branding do not
 * depend on each other, so all three start together. The only dependent step
 * is switching the session's active organization when it differs from the
 * one the user should land on, and that is skipped in the common case.
 */

export const PORTAL_ORG_KEY = "portal-active-org";

export type PortalOrganization = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  type: string;
  createdAt: string;
  memberRole: string;
};

const PORTAL_ORGANIZATIONS_KEY = ["portal-organizations"] as const;

/**
 * CLIENT organizations where the user holds an external portal role. This is
 * a user-level list, so (like branding) its key is deliberately not scoped to
 * an organization; `loadPortalStartup` drops it when the user changes.
 */
export function portalOrganizationsQueryOptions() {
  return queryOptions({
    queryKey: PORTAL_ORGANIZATIONS_KEY,
    queryFn: async (): Promise<Array<PortalOrganization>> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/organizations`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar as organizações");
      }
      return response.json();
    },
  });
}

/** The part of the Better Auth session the portal startup depends on. */
export type PortalSessionData = {
  user: { id: string; name?: string | null };
  session?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Narrows the untyped `getSession()` payload; anything else is "no session". */
export function parsePortalSession(value: unknown): PortalSessionData | null {
  if (!isRecord(value) || !isRecord(value.user)) return null;
  const { id, name } = value.user;
  if (typeof id !== "string") return null;
  if (name !== undefined && name !== null && typeof name !== "string") {
    return null;
  }
  return {
    user: { id, name },
    session: value.session,
  };
}

type StartupDependencies = {
  queryClient: QueryClient;
  readSession: () => Promise<{ data: PortalSessionData | null }>;
  /** Makes `organizationId` the session's active organization. */
  setActiveOrganization: (organizationId: string) => Promise<unknown>;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

export type PortalStartup =
  | { status: "signed-out" }
  | {
      status: "ready";
      session: PortalSessionData;
      organizations: Array<PortalOrganization>;
      /** The client organization the portal renders (already active). */
      organizationId: string | null;
    };

/** Better Auth stores the active organization on the session row. */
function readActiveOrganizationId(session: unknown): string | null {
  if (!isRecord(session) || !isRecord(session.session)) return null;
  const id = session.session.activeOrganizationId;
  return typeof id === "string" && id ? id : null;
}

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

const lastUserByClient = new WeakMap<QueryClient, string>();

export async function loadPortalStartup({
  queryClient,
  readSession,
  setActiveOrganization,
  storage = getBrowserStorage() ?? undefined,
}: StartupDependencies): Promise<PortalStartup> {
  // All three start before anything is awaited.
  const sessionRead = readSession();
  const organizationsRead = queryClient.ensureQueryData(
    portalOrganizationsQueryOptions(),
  );
  void prefetchBranding(queryClient);

  const [sessionResult, organizationsResult] = await Promise.allSettled([
    sessionRead,
    organizationsRead,
  ]);

  if (sessionResult.status === "rejected") throw sessionResult.reason;
  const session = sessionResult.value.data;
  // Signed out: the organizations request is expected to have been refused.
  if (!session) return { status: "signed-out" };
  if (organizationsResult.status === "rejected") {
    throw organizationsResult.reason;
  }

  let organizations = organizationsResult.value;

  // Cached state belongs to whoever was signed in when it was fetched.
  const previousUserId = lastUserByClient.get(queryClient);
  lastUserByClient.set(queryClient, session.user.id);
  if (previousUserId !== undefined && previousUserId !== session.user.id) {
    queryClient.clear();
    organizations = await queryClient.fetchQuery(
      portalOrganizationsQueryOptions(),
    );
    void prefetchBranding(queryClient);
  }

  const storedId = storage?.getItem(PORTAL_ORG_KEY) ?? null;
  const activeId = readActiveOrganizationId(session);
  const target =
    organizations.find((org) => org.id === storedId) ??
    organizations.find((org) => org.id === activeId) ??
    organizations[0] ??
    null;

  if (target && target.id !== activeId) {
    await setActiveOrganization(target.id);
  }
  if (target) storage?.setItem(PORTAL_ORG_KEY, target.id);

  return {
    status: "ready",
    session,
    organizations,
    organizationId: target?.id ?? null,
  };
}
