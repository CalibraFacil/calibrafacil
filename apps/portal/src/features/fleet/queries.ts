import { useQuery } from "@tanstack/react-query";

import {
  portalFleetAssetsResponseSchema,
  portalUnitsResponseSchema,
} from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
import { keepPreviousDataInScope } from "@calibra-facil/shared/query-scope";
import { usePortalKeys } from "@/lib/portal-keys";
import type { CalibrationFilter } from "@/lib/calibration-status";
import type { FleetAssetsResponse, FleetSortBy } from "./types";

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
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    sortBy: params.sortBy,
    sortDir: params.sortDir,
  });
  if (params.query) searchParams.set("query", params.query);
  if (params.dueStatus) searchParams.set("dueStatus", params.dueStatus);
  if (params.unitId) searchParams.set("unitId", String(params.unitId));

  return fetchPortalJson(
    `/api/portal/assets?${searchParams.toString()}`,
    portalFleetAssetsResponseSchema,
    { errorMessage: "Falha ao carregar ativos" },
  );
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
    queryFn: () =>
      fetchPortalJson("/api/portal/units", portalUnitsResponseSchema, {
        errorMessage: "Falha ao carregar unidades",
      }),
    staleTime: 60_000,
  });
}
