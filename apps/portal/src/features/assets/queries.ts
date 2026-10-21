import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";
import { usePortalQueryKey } from "@/lib/portal-org-context";
import type { AssetDetail, IntervalInsight } from "./types";

export function useAssetDetail(assetId: string) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-asset", assetId),
    queryFn: async (): Promise<AssetDetail> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${assetId}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar ativo.");
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- portal asset endpoint returns the AssetDetail DTO.
      const result = (await response.json()) as { data: AssetDetail };
      return result.data;
    },
  });
}

/**
 * Reliability-based interval analysis (ILAC-G24 / NCSL RP-1). Shared by the
 * attention strip and the analysis panel — same key, one request.
 */
export function useIntervalInsight(assetId: number) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-interval-insight", assetId),
    queryFn: async (): Promise<IntervalInsight> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${assetId}/interval-insight`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Falha ao carregar a análise.");
      return response.json();
    },
    staleTime: 60_000,
  });
}
