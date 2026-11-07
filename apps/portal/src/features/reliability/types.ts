/**
 * The #740 reliability surface: fleet as-found analytics (EOPR, "confiabilidade
 * observada"), per-asset drift series and the §7.1.5.2 out-of-tolerance
 * ("fora de tolerância na condição 'como recebido'") events. The types are the
 * contracts of `/api/portal/analytics/fleet`, `/assets/:id/drift-series` and
 * `/oot-events`; the portal never recomputes verdicts.
 */

import type {
  PortalDriftSeriesResponse,
  PortalFleetAnalyticsResponse,
  PortalOotEvent,
} from "@calibra-facil/contracts/portal-client";

export type FleetAnalytics = PortalFleetAnalyticsResponse;
export type FleetAnalyticsBucket = FleetAnalytics["period"]["bucket"];
export type FleetTrendBucket = FleetAnalytics["trend"][number];

export type AssetDriftSeries = PortalDriftSeriesResponse;
export type DriftPointSeries = AssetDriftSeries["points"][number];

export type OotEvent = PortalOotEvent;
export type OotEventStatus = OotEvent["status"];
export type OotDecision = NonNullable<OotEvent["assessmentDecision"]>;

export function isOotDecision(value: string): value is OotDecision {
  return (
    value === "NO_IMPACT" ||
    value === "IMPACT_CONTAINED" ||
    value === "IMPACT_ESCALATED"
  );
}
