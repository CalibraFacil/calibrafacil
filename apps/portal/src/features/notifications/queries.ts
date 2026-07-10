import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";

/**
 * ISO/IEC 17025 §7.10 out-of-tolerance notifications: the lab informed this
 * customer that a calibration result (or a lab reference standard used in
 * their calibration) was found out of tolerance. Acknowledging registers
 * *receipt only* — the customer still evaluates the impact on their
 * measurements on their side.
 */

export type PortalNotificationStatus =
  | "PENDING"
  | "GENERATED"
  | "SENT"
  | "ACKNOWLEDGED";

export type PortalNotificationAckVia = "email_link" | "portal_link" | "manual";

export type PortalNotification = {
  /** Opaque acknowledgment token — never a numeric database id. */
  id: string;
  ncNumber: string;
  certificateNumber: string | null;
  affectedScope: string | null;
  status: PortalNotificationStatus;
  sentAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedVia: PortalNotificationAckVia | null;
  createdAt: string;
  assetName: string | null;
  assetTag: string | null;
  unitName: string | null;
};

export type NotificationsResponse = {
  data: Array<PortalNotification>;
  counts: {
    total: number;
    pending: number;
  };
};

export const NOTIFICATIONS_QUERY_KEY = ["portal-notifications"];

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async (): Promise<NotificationsResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notifications`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar as notificações.");
      }
      const result: NotificationsResponse = await response.json();
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
export function useAcknowledgeNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notifications/${id}/acknowledge`,
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
        queryKey: NOTIFICATIONS_QUERY_KEY,
      });
    },
  });
}
