import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePortalKeys } from "@/lib/portal-keys";
import type {
  AssetDriftSeries,
  FleetAnalytics,
  FleetAnalyticsBucket,
  OotEvent,
  OotEventStatus,
} from "./types";
import { portalApi } from "@/lib/portal-api";

export type FleetAnalyticsParams = {
  periodMonths: number;
  bucket: FleetAnalyticsBucket;
  /** Group cockpit: narrow the consolidated view to one unit (branch customer). */
  unitId?: number;
};

async function fetchFleetAnalytics(
  params: FleetAnalyticsParams,
): Promise<FleetAnalytics> {
  return portalApi.reliability.fleetAnalytics({
    query: {
      periodMonths: params.periodMonths,
      bucket: params.bucket,
      unitId: params.unitId || undefined,
    },
  });
}

/** Fleet as-found reliability analytics (EOPR) — lab verdicts, never recomputed. */
export function useFleetAnalytics(params: FleetAnalyticsParams) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.fleetAnalytics(params),
    queryFn: () => fetchFleetAnalytics(params),
    staleTime: 60_000,
  });
}

/** Matched-point as-found margin series + OLS drift regression for one asset. */
export function useDriftSeries(assetId: number) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.driftSeries(assetId),
    queryFn: (): Promise<AssetDriftSeries> =>
      portalApi.assets.driftSeries({ params: { id: assetId } }),
    staleTime: 60_000,
  });
}

/**
 * Out-of-tolerance events in the active scope, newest first. Omit `status` to
 * fetch OPEN and ASSESSED together (the asset panel filters client-side).
 */
export function useOotEvents(status?: OotEventStatus) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.ootEventsByStatus(status),
    queryFn: async (): Promise<Array<OotEvent>> => {
      const payload = await portalApi.reliability.ootEvents({
        query: { status },
      });
      return payload.data;
    },
    staleTime: 60_000,
  });
}

type OotAssessmentInput = Parameters<
  typeof portalApi.reliability.assessOotEvent
>[0]["body"];

/**
 * Records the customer's impact assessment of an out-of-tolerance event
 * (ISO 9001:2015 §7.1.5.2): the event leaves OPEN, so the events refetch.
 */
export function useAssessOotEvent(
  eventId: number,
  callbacks: { onSuccess: () => void; onError: (error: Error) => void },
) {
  const queryClient = useQueryClient();
  const keys = usePortalKeys();
  return useMutation({
    mutationFn: async (body: OotAssessmentInput): Promise<void> => {
      await portalApi.reliability.assessOotEvent({
        params: { id: eventId },
        body,
      });
    },
    onSuccess: () => {
      callbacks.onSuccess();
      queryClient.invalidateQueries({ queryKey: keys.ootEvents });
    },
    onError: callbacks.onError,
  });
}
