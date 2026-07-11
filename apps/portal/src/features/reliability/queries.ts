import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";
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

  const response = await fetch(
    `${getApiBaseUrl()}/api/portal/analytics/fleet?${searchParams.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Falha ao carregar os indicadores de confiabilidade");
  }
  return response.json();
}

/** Fleet as-found reliability analytics (EOPR) — lab verdicts, never recomputed. */
export function useFleetAnalytics(params: FleetAnalyticsParams) {
  return useQuery({
    queryKey: ["portal-fleet-analytics", params],
    queryFn: () => fetchFleetAnalytics(params),
    staleTime: 60_000,
  });
}

/** Matched-point as-found margin series + OLS drift regression for one asset. */
export function useDriftSeries(assetId: number) {
  return useQuery({
    queryKey: ["portal-drift-series", assetId],
    queryFn: async (): Promise<AssetDriftSeries> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${assetId}/drift-series`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar a análise de deriva");
      }
      return response.json();
    },
    staleTime: 60_000,
  });
}

/**
 * Out-of-tolerance events in the active scope, newest first. Omit `status` to
 * fetch OPEN and ASSESSED together (the asset panel filters client-side).
 */
export function useOotEvents(status?: OotEventStatus) {
  return useQuery({
    queryKey: ["portal-oot-events", status ?? "all"],
    queryFn: async (): Promise<Array<OotEvent>> => {
      const searchParams = new URLSearchParams();
      if (status) searchParams.set("status", status);
      const suffix = status ? `?${searchParams.toString()}` : "";
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/oot-events${suffix}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar eventos fora de tolerância");
      }
      const payload: { data: Array<OotEvent> } = await response.json();
      return payload.data;
    },
    staleTime: 60_000,
  });
}
