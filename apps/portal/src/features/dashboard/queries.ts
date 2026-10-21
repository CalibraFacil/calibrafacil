import { useQuery } from "@tanstack/react-query";

import {
  portalOverviewResponseSchema,
  type PortalOverviewResponse,
} from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
import { getApiBaseUrl } from "@/lib/utils";
import { usePortalQueryKey } from "@/lib/portal-org-context";

export type PortalOverview = PortalOverviewResponse;

export type OverviewCertificate =
  PortalOverview["certificates"]["recent"][number];

async function fetchOverview(): Promise<PortalOverview> {
  return fetchPortalJson("/api/portal/overview", portalOverviewResponseSchema, {
    errorMessage: "Falha ao carregar o painel",
  });
}

export function useOverview() {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-overview"),
    queryFn: fetchOverview,
    staleTime: 60_000,
  });
}

export type UnitSummaryItem = {
  id: number;
  name: string;
  total: number;
  overdue: number;
  dueSoon: number;
};

type UnitSummaryResponse = {
  mode?: "single" | "group";
  units: Array<UnitSummaryItem>;
};

/** Per-unit calibration breakdown; more than one unit only in group mode. */
export function useUnitSummary() {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-unit-summary"),
    queryFn: async (): Promise<UnitSummaryResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/units/summary`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar o resumo por unidade");
      }
      return response.json();
    },
    staleTime: 60_000,
  });
}
