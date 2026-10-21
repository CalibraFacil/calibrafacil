import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";
import { usePortalQueryKey } from "@/lib/portal-org-context";

/**
 * ISO/IEC 17025 §7.10 out-of-tolerance notifications: the lab informed this
 * customer that a calibration result (or a lab reference standard used in
 * their calibration) was found out of tolerance. Acknowledging registers
 * *receipt only* — the customer still evaluates the impact on their
 * measurements on their side.
 */

export type OotNotificationStatus =
  | "PENDING"
  | "GENERATED"
  | "SENT"
  | "ACKNOWLEDGED";

export type OotNotificationAckVia = "email_link" | "portal_link" | "manual";

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

const OOT_NOTIFICATIONS_SCOPE = "portal-oot-notifications";

export function useOotNotifications() {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key(OOT_NOTIFICATIONS_SCOPE),
    queryFn: async (): Promise<OotNotificationsResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/oot-notifications`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar as notificações.");
      }
      const result: OotNotificationsResponse = await response.json();
      return result;
    },
    staleTime: 60_000,
  });
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (
    body !== null &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }
  return fallback;
}

/** POST acknowledge (idempotent). `id` is the opaque token from the list. */
export function useAcknowledgeOotNotification() {
  const key = usePortalQueryKey();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/oot-notifications/${id}/acknowledge`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(
          extractErrorMessage(
            body,
            "Não foi possível confirmar o recebimento.",
          ),
        );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: key(OOT_NOTIFICATIONS_SCOPE),
      });
    },
  });
}
