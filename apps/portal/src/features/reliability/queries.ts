import { useQuery } from "@tanstack/react-query";

import {
  portalDriftSeriesResponseSchema,
  portalFleetAnalyticsResponseSchema,
  portalOotEventsResponseSchema,
} from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
import { usePortalQueryKey } from "@/lib/portal-org-context";
import type {
  AssetDriftSeries,
  FleetAnalytics,
  FleetAnalyticsBucket,
  OotEvent,
  OotEventStatus,
} from "./types";

export type FleetAnalyticsParams = {
  periodMonths: number;
  bucket: FleetAnalyticsBucket;
  /** Group cockpit: narrow the consolidated view to one unit (branch customer). */
  unitId?: number;
};

async function fetchFleetAnalytics(
  params: FleetAnalyticsParams,
): Promise<FleetAnalytics> {
  const searchParams = new URLSearchParams({
    periodMonths: String(params.periodMonths),
    bucket: params.bucket,
  });
  if (params.unitId) searchParams.set("unitId", String(params.unitId));

  return fetchPortalJson(
    `/api/portal/analytics/fleet?${searchParams.toString()}`,
    portalFleetAnalyticsResponseSchema,
    { errorMessage: "Falha ao carregar os indicadores de confiabilidade" },
  );
}

/** Fleet as-found reliability analytics (EOPR) — lab verdicts, never recomputed. */
export function useFleetAnalytics(params: FleetAnalyticsParams) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-fleet-analytics", params),
    queryFn: () => fetchFleetAnalytics(params),
    staleTime: 60_000,
  });
}

/** Matched-point as-found margin series + OLS drift regression for one asset. */
export function useDriftSeries(assetId: number) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-drift-series", assetId),
    queryFn: (): Promise<AssetDriftSeries> =>
      fetchPortalJson(
        `/api/portal/assets/${assetId}/drift-series`,
        portalDriftSeriesResponseSchema,
        { errorMessage: "Falha ao carregar a análise de deriva" },
      ),
    staleTime: 60_000,
  });
}

/**
 * Out-of-tolerance events in the active scope, newest first. Omit `status` to
 * fetch OPEN and ASSESSED together (the asset panel filters client-side).
 */
export function useOotEvents(status?: OotEventStatus) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-oot-events", status ?? "all"),
    queryFn: async (): Promise<Array<OotEvent>> => {
      const searchParams = new URLSearchParams();
      if (status) searchParams.set("status", status);
      const suffix = status ? `?${searchParams.toString()}` : "";
      const payload = await fetchPortalJson(
        `/api/portal/oot-events${suffix}`,
        portalOotEventsResponseSchema,
        { errorMessage: "Falha ao carregar eventos fora de tolerância" },
      );
      return payload.data;
    },
    staleTime: 60_000,
  });
}
