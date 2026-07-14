import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";

export type PortalVisitStatus =
  | "PROPOSED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type PortalVisitAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
} | null;

export type PortalVisitReschedulePeriod = "MORNING" | "AFTERNOON" | "ANY";

export type PortalVisitPreferredWindow = {
  /** ISO yyyy-mm-dd */
  date: string;
  period: PortalVisitReschedulePeriod;
  note?: string;
};

export type PortalVisitRescheduleRequest = {
  id: number;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
  reason: string | null;
  preferredWindows: Array<PortalVisitPreferredWindow>;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type PortalVisit = {
  id: number;
  status: PortalVisitStatus;
  scheduledAt: string | null;
  scheduledEndAt: string | null;
  address: PortalVisitAddress;
  customerName: string;
  technicianName: string | null;
  sourceRequestId: number | null;
  cancelReason: string | null;
  assetCount: number;
  customerConfirmedAt: string | null;
  /** Latest reschedule request for this visit (any status), if one exists. */
  rescheduleRequest: PortalVisitRescheduleRequest | null;
};

type PortalVisitsResponse = {
  data: Array<PortalVisit>;
};

export const PORTAL_VISITS_QUERY_KEY = ["portal-visits"] as const;

async function fetchVisits(): Promise<PortalVisitsResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/portal/visits`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Falha ao carregar as visitas");
  }
  return response.json();
}

/** On-site visits scheduled for the customer (excludes cancelled). */
export function usePortalVisits() {
  return useQuery({
    queryKey: PORTAL_VISITS_QUERY_KEY,
    queryFn: fetchVisits,
    staleTime: 60_000,
  });
}

async function throwResponseError(
  response: Response,
  fallback: string,
): Promise<never> {
  const body: unknown = await response.json().catch(() => null);
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    throw new Error(body.error);
  }
  throw new Error(fallback);
}

function useInvalidateVisits() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: PORTAL_VISITS_QUERY_KEY });
  };
}

/** #739: one-tap "Confirmar presença" on a proposed/confirmed visit. */
export function useConfirmVisitPresence() {
  const invalidate = useInvalidateVisits();
  return useMutation({
    mutationFn: async (visitId: number): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/visits/${visitId}/confirm`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!response.ok) {
        return throwResponseError(
          response,
          "Não foi possível confirmar a presença.",
        );
      }
    },
    onSuccess: invalidate,
  });
}

export type RequestVisitRescheduleInput = {
  visitId: number;
  reason: string;
  preferredWindows: Array<PortalVisitPreferredWindow>;
};

/** #739: "Solicitar reagendamento" — opens a request the lab resolves. */
export function useRequestVisitReschedule() {
  const invalidate = useInvalidateVisits();
  return useMutation({
    mutationFn: async ({
      visitId,
      reason,
      preferredWindows,
    }: RequestVisitRescheduleInput): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/visits/${visitId}/reschedule-request`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reason.trim() === "" ? null : reason.trim(),
            preferredWindows,
          }),
        },
      );
      if (!response.ok) {
        return throwResponseError(
          response,
          "Não foi possível solicitar o reagendamento.",
        );
      }
    },
    onSuccess: invalidate,
  });
}

export const PORTAL_VISIT_STATUS_LABELS: Record<PortalVisitStatus, string> = {
  PROPOSED: "Proposta",
  CONFIRMED: "Confirmada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

export const PREFERRED_PERIOD_LABELS: Record<
  PortalVisitReschedulePeriod,
  string
> = {
  MORNING: "Manhã",
  AFTERNOON: "Tarde",
  ANY: "Qualquer horário",
};

/** A visit the customer can still act on (confirm / ask to reschedule). */
export function isVisitActionable(visit: PortalVisit): boolean {
  if (visit.status !== "PROPOSED" && visit.status !== "CONFIRMED") {
    return false;
  }
  if (!visit.scheduledAt) return false;
  return new Date(visit.scheduledAt).getTime() > Date.now();
}

export function formatPortalVisitAddress(address: PortalVisitAddress): string {
  if (!address) return "";
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const region = [address.neighbourhood, address.city, address.state]
    .filter(Boolean)
    .join(" - ");
  return [street, region]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}
