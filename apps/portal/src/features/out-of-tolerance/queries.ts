import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PortalOotNotificationsResponse } from "@calibra-facil/contracts";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

/**
 * ISO/IEC 17025 §7.10 out-of-tolerance notifications: the lab informed this
 * customer that a calibration result (or a lab reference standard used in
 * their calibration) was found out of tolerance. Acknowledging registers
 * *receipt only* — the customer still evaluates the impact on their
 * measurements on their side.
 */

/** `id` is the opaque acknowledgment token, never a numeric database id. */
export type OotNotification = PortalOotNotificationsResponse["data"][number];

export function useOotNotifications() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.ootNotifications,
    queryFn: () => portalApi.ootNotifications.list(),
    staleTime: 60_000,
  });
}

/** POST acknowledge (idempotent). `id` is the opaque token from the list. */
export function useAcknowledgeOotNotification() {
  const keys = usePortalKeys();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await portalApi.ootNotifications.acknowledge(
        { params: { token: id } },
        { serverErrorMessage: true },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: keys.ootNotifications,
      });
    },
  });
}
