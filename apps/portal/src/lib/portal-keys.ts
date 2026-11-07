import { useMemo } from "react";

import { usePortalQueryKey } from "./portal-org-context";
import type { PortalQueryKeyBuilder } from "./portal-query-keys";

/**
 * Every authenticated portal query key, in one place. Queries, invalidations,
 * `setQueryData` and placeholder scopes all call this factory (through
 * `usePortalKeys()`), so a reshaped key moves them together. Each key is built
 * with the active organization as its first segment (`portalQueryKey`).
 * Properties are whole keys or prefixes; functions take the key's variables.
 */
export function createPortalKeys(key: PortalQueryKeyBuilder) {
  return {
    overview: key("portal-overview"),
    unitSummary: key("portal-unit-summary"),
    units: key("portal-units"),

    /** Every asset detail. */
    assetDetails: key("portal-asset"),
    asset: (assetId: string | number) => key("portal-asset", assetId),
    intervalInsights: key("portal-interval-insight"),
    intervalInsight: (assetId: string | number) =>
      key("portal-interval-insight", assetId),
    /** The fleet list, every page and filter. */
    fleetAssets: key("portal-assets"),
    fleetAssetsPage: (params: unknown) => key("portal-assets", params),
    fleetAnalytics: (params: unknown) => key("portal-fleet-analytics", params),
    driftSeries: (assetId: number) => key("portal-drift-series", assetId),

    calendar: (from: unknown, to: unknown, unitId: unknown) =>
      key("portal-calendar", from, to, unitId ?? null),

    certificates: key("portal-certificates"),
    certificatesPage: (filters: {
      page: number;
      limit: number;
      search: string;
      dateFrom: unknown;
      dateTo: unknown;
      assetId: unknown;
    }) =>
      key(
        "portal-certificates",
        filters.page,
        filters.limit,
        filters.search,
        filters.dateFrom,
        filters.dateTo,
        filters.assetId ?? null,
      ),
    certificate: (id: string) => key("portal-certificate", id),
    auditPacks: key("portal-audit-packs"),

    requests: key("portal-requests"),
    requestsPage: (filters: {
      page: number;
      limit: number;
      search: string;
      statusFilter: unknown;
    }) =>
      key(
        "portal-requests",
        filters.page,
        filters.limit,
        filters.search,
        filters.statusFilter,
      ),
    requestDetail: (id: string) => key("portal-request-detail", id),
    requestPreselect: (preselectKey: unknown) =>
      key("portal-request-preselect", preselectKey),
    requestAssets: (page: number, limit: number, search: string) =>
      key("portal-request-assets", page, limit, search),

    serviceOrders: key("portal-service-orders"),
    serviceOrdersPage: (filters: {
      page: number;
      limit: number;
      search: string;
      statusFilter: unknown;
    }) =>
      key(
        "portal-service-orders",
        filters.page,
        filters.limit,
        filters.search,
        filters.statusFilter,
      ),
    serviceOrder: (id: string) => key("portal-service-order", id),
    serviceOrderFinancialSummary: (id: string) =>
      key("portal-service-order", id, "financial-summary"),

    visits: key("portal-visits"),

    notificationFeed: key("portal-notification-feed"),
    notificationCount: key("portal-notification-count"),
    notificationPreferences: key("portal-notification-preferences"),

    ootNotifications: key("portal-oot-notifications"),
    ootEvents: key("portal-oot-events"),
    ootEventsByStatus: (status: string | undefined) =>
      key("portal-oot-events", status ?? "all"),

    /** Command menu searches. */
    commandAssets: (term: string) => key("cmd-assets", term),
    commandCertificates: (term: string) => key("cmd-certificates", term),
  };
}

export type PortalKeys = ReturnType<typeof createPortalKeys>;

/** The portal key factory bound to the active client organization. */
export function usePortalKeys(): PortalKeys {
  const key = usePortalQueryKey();
  return useMemo(() => createPortalKeys(key), [key]);
}

/**
 * Keys of the signed-out surface and of user-level data (the organization list,
 * branding): deliberately not scoped to an organization.
 */
export const portalPublicKeys = {
  branding: ["portal-branding"] as const,
  organizations: ["portal-organizations"] as const,
  acceptInviteOrganization: (organizationSlug: string) =>
    ["portal-organizations", "accept-invite", organizationSlug] as const,
  invitation: (token: string | undefined) =>
    ["portal-invitation", token] as const,
  magicLinkPreview: (token: string | undefined) =>
    ["portal-magic-link-preview", token] as const,
  publicServiceOrder: (token: string) =>
    ["public-service-order", token] as const,
  verification: (token: string) => ["verification", token] as const,
  verificationSignature: (token: string) =>
    ["verification-signature", token] as const,
};
