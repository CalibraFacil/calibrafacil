import { useQuery } from "@tanstack/react-query";

import {
  portalAssetDetailResponseSchema,
  portalIntervalInsightSchema,
} from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
import { usePortalQueryKey } from "@/lib/portal-org-context";
import type { AssetDetail, IntervalInsight } from "./types";

export function useAssetDetail(assetId: string) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-asset", assetId),
    queryFn: async (): Promise<AssetDetail> => {
      const result = await fetchPortalJson(
        `/api/portal/assets/${encodeURIComponent(assetId)}`,
        portalAssetDetailResponseSchema,
        { errorMessage: "Falha ao carregar ativo." },
      );
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
    queryFn: (): Promise<IntervalInsight> =>
      fetchPortalJson(
        `/api/portal/assets/${assetId}/interval-insight`,
        portalIntervalInsightSchema,
        { errorMessage: "Falha ao carregar a análise." },
      ),
    staleTime: 60_000,
  });
}
