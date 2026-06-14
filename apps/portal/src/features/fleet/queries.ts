import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";
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

  const response = await fetch(
    `${getApiBaseUrl()}/api/portal/assets?${searchParams.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Falha ao carregar ativos");
  }
  return response.json();
}

export function useFleetAssets(params: FleetAssetsParams) {
  return useQuery({
    queryKey: ["portal-assets", params],
    queryFn: () => fetchFleetAssets(params),
  });
}

export type PortalUnit = { id: number; name: string };

type PortalUnitsResponse = {
  mode?: "single" | "group";
  units: Array<PortalUnit>;
};

/** Units (branch customers) in the active scope; more than one only in group mode. */
export function usePortalUnits() {
  return useQuery({
    queryKey: ["portal-units"],
    queryFn: async (): Promise<PortalUnitsResponse> => {
      const response = await fetch(`${getApiBaseUrl()}/api/portal/units`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Falha ao carregar unidades");
      }
      return response.json();
    },
    staleTime: 60_000,
  });
}
