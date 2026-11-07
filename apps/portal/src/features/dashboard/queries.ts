import { useQuery } from "@tanstack/react-query";

import {
  portalOverviewResponseSchema,
  portalUnitsSummaryResponseSchema,
  type PortalOverviewResponse,
  type PortalUnitsSummaryResponse,
} from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
import { usePortalKeys } from "@/lib/portal-keys";

export type PortalOverview = PortalOverviewResponse;

export type OverviewCertificate =
  PortalOverview["certificates"]["recent"][number];

async function fetchOverview(): Promise<PortalOverview> {
  return fetchPortalJson("/api/portal/overview", portalOverviewResponseSchema, {
    errorMessage: "Falha ao carregar o painel",
  });
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
    queryFn: () =>
      fetchPortalJson(
        "/api/portal/units/summary",
        portalUnitsSummaryResponseSchema,
        { errorMessage: "Falha ao carregar o resumo por unidade" },
      ),
    staleTime: 60_000,
  });
}
