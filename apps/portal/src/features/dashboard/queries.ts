import { useQuery } from "@tanstack/react-query";

import {
  portalOverviewResponseSchema,
  portalUnitsSummaryResponseSchema,
  type PortalOverviewResponse,
  type PortalUnitsSummaryResponse,
} from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
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

export type UnitSummaryItem = PortalUnitsSummaryResponse["units"][number];

/** Per-unit calibration breakdown; more than one unit only in group mode. */
export function useUnitSummary() {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-unit-summary"),
    queryFn: () =>
      fetchPortalJson(
        "/api/portal/units/summary",
        portalUnitsSummaryResponseSchema,
        { errorMessage: "Falha ao carregar o resumo por unidade" },
      ),
    staleTime: 60_000,
  });
}
