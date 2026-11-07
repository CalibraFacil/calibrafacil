import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePortalKeys } from "@/lib/portal-keys";
import type { AssetDetail, IntervalInsight } from "./types";
import { portalApi } from "@/lib/portal-api";

export function useAssetDetail(assetId: string) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.asset(assetId),
    queryFn: async (): Promise<AssetDetail> => {
      const result = await portalApi.assets.get({ params: { id: assetId } });
      return result.data;
    },
  });
}

/**
 * Reliability-based interval analysis (ILAC-G24 / NCSL RP-1). Shared by the
 * attention strip and the analysis panel — same key, one request.
 */
export function useIntervalInsight(assetId: number) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.intervalInsight(assetId),
    queryFn: (): Promise<IntervalInsight> =>
      portalApi.assets.intervalInsight({ params: { id: assetId } }),
    staleTime: 60_000,
  });
}

type SetIntervalInput = {
  intervalMonths: number;
  rationale: string;
  /** `engine` when the customer applied the reliability engine's suggestion. */
  source?: "customer" | "engine";
};

/**
 * The customer sets the instrument's calibration interval (a manual edit or the
 * applied engine suggestion). The detail, the fleet list and the analysis are
 * all read from the interval, so all three refetch.
 */
export function useSetAssetInterval(
  assetId: number,
  callbacks: { onSuccess?: () => void; onError?: (error: Error) => void } = {},
) {
  const queryClient = useQueryClient();
  const keys = usePortalKeys();
  return useMutation({
    mutationFn: async (body: SetIntervalInput): Promise<void> => {
      await portalApi.assets.setInterval({ params: { id: assetId }, body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.assetDetails });
      queryClient.invalidateQueries({ queryKey: keys.fleetAssets });
      queryClient.invalidateQueries({ queryKey: keys.intervalInsights });
      callbacks.onSuccess?.();
    },
    onError: callbacks.onError,
  });
}
