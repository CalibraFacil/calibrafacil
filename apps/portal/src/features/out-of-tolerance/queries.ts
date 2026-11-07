import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  portalOotAcknowledgeResponseSchema,
  portalOotNotificationsResponseSchema,
} from "@calibra-facil/contracts";
import type { OotNotificationStatus } from "@calibra-facil/schemas/machines";

import { fetchPortalJson, jsonInit } from "@/lib/api-fetch";
import { usePortalKeys } from "@/lib/portal-keys";

/**
 * ISO/IEC 17025 §7.10 out-of-tolerance notifications: the lab informed this
 * customer that a calibration result (or a lab reference standard used in
 * their calibration) was found out of tolerance. Acknowledging registers
 * *receipt only* — the customer still evaluates the impact on their
 * measurements on their side.
 */

type OotNotificationAckVia = "email_link" | "portal_link" | "manual";

export type OotNotification = {
  /** Opaque acknowledgment token — never a numeric database id. */
  id: string;
  ncNumber: string;
  certificateNumber: string | null;
  affectedScope: string | null;
  status: OotNotificationStatus;
  sentAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedVia: OotNotificationAckVia | null;
  createdAt: string;
  assetName: string | null;
  assetTag: string | null;
  unitName: string | null;
};

export type OotNotificationsResponse = {
  data: Array<OotNotification>;
  counts: {
    total: number;
    pending: number;
  };
};

export function useOotNotifications() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.ootNotifications,
    queryFn: (): Promise<OotNotificationsResponse> =>
      fetchPortalJson(
        "/api/portal/oot-notifications",
        portalOotNotificationsResponseSchema,
        { errorMessage: "Falha ao carregar as notificações." },
      ),
    staleTime: 60_000,
  });
}

/** POST acknowledge (idempotent). `id` is the opaque token from the list. */
export function useAcknowledgeOotNotification() {
  const keys = usePortalKeys();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await fetchPortalJson(
        `/api/portal/oot-notifications/${id}/acknowledge`,
        portalOotAcknowledgeResponseSchema,
        {
          errorMessage: "Não foi possível confirmar o recebimento.",
          serverErrorMessage: true,
          init: jsonInit("POST"),
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: keys.ootNotifications,
      });
    },
  });
}
