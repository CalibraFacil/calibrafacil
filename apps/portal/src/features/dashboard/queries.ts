import { useQuery } from "@tanstack/react-query";

import {
  type PortalOverviewResponse,
  type PortalUnitsSummaryResponse,
} from "@calibra-facil/contracts";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

export type PortalOverview = PortalOverviewResponse;

export type OverviewCertificate =
  PortalOverview["certificates"]["recent"][number];

async function fetchOverview(): Promise<PortalOverview> {
  return portalApi.dashboard.overview();
}

export function useOverview() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.overview,
    queryFn: fetchOverview,
    staleTime: 60_000,
  });
}

export type UnitSummaryItem = PortalUnitsSummaryResponse["units"][number];

/** Per-unit calibration breakdown; more than one unit only in group mode. */
export function useUnitSummary() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.unitSummary,
    queryFn: () => portalApi.dashboard.unitsSummary(),
    staleTime: 60_000,
  });
}
