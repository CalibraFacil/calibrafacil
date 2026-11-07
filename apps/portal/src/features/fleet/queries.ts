import { useQuery } from "@tanstack/react-query";

import { keepPreviousDataInScope } from "@calibra-facil/shared/query-scope";
import { usePortalKeys } from "@/lib/portal-keys";
import type { CalibrationFilter } from "@/lib/calibration-status";
import type { FleetAssetsResponse, FleetSortBy } from "./types";
import { portalApi } from "@/lib/portal-api";

export type FleetAssetsParams = {
  page: number;
  limit: number;
  query?: string;
  dueStatus?: CalibrationFilter;
  sortBy: FleetSortBy;
  sortDir: "asc" | "desc";
  /** Group cockpit: narrow the consolidated view to one unit (branch customer). */
  unitId?: number;
};

async function fetchFleetAssets(
  params: FleetAssetsParams,
): Promise<FleetAssetsResponse> {
  return portalApi.assets.list({
    query: {
      page: params.page,
      limit: params.limit,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      query: params.query || undefined,
      dueStatus: params.dueStatus || undefined,
      unitId: params.unitId || undefined,
    },
  });
}

export function useFleetAssets(params: FleetAssetsParams) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.fleetAssetsPage(params),
    queryFn: () => fetchFleetAssets(params),
    placeholderData: keepPreviousDataInScope(keys.fleetAssets),
  });
}

/** Units (branch customers) in the active scope; more than one only in group mode. */
export function usePortalUnits() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.units,
    queryFn: () => portalApi.dashboard.units(),
    staleTime: 60_000,
  });
}
