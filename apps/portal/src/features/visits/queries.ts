import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  portalVisitConfirmResponseSchema,
  portalVisitRescheduleResponseSchema,
  portalVisitsResponseSchema,
} from "@calibra-facil/contracts";

import type { Address } from "@calibra-facil/shared/address";
import type {
  VisitRescheduleRequestStatus,
  VisitStatus,
} from "@calibra-facil/schemas/machines";
import { fetchPortalJson, jsonInit } from "@/lib/api-fetch";
import { usePortalQueryKey } from "@/lib/portal-org-context";

type PortalVisitStatus = VisitStatus;

type PortalVisitAddress = Address | null;

export type PortalVisitReschedulePeriod = "MORNING" | "AFTERNOON" | "ANY";

type PortalVisitPreferredWindow = {
  /** ISO yyyy-mm-dd */
  date: string;
  period: PortalVisitReschedulePeriod;
  note?: string;
};

type PortalVisitRescheduleRequest = {
  id: number;
  status: VisitRescheduleRequestStatus;
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

const PORTAL_VISITS_SCOPE = "portal-visits";

function fetchVisits(): Promise<PortalVisitsResponse> {
  return fetchPortalJson("/api/portal/visits", portalVisitsResponseSchema, {
    errorMessage: "Falha ao carregar as visitas",
  });
}

/** On-site visits scheduled for the customer (excludes cancelled). */
export function usePortalVisits() {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key(PORTAL_VISITS_SCOPE),
    queryFn: fetchVisits,
    staleTime: 60_000,
  });
}

function useInvalidateVisits() {
  const key = usePortalQueryKey();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: key(PORTAL_VISITS_SCOPE) });
  };
}

/** #739: one-tap "Confirmar presença" on a proposed/confirmed visit. */
export function useConfirmVisitPresence() {
  const invalidate = useInvalidateVisits();
  return useMutation({
    mutationFn: async (visitId: number): Promise<void> => {
      await fetchPortalJson(
        `/api/portal/visits/${visitId}/confirm`,
        portalVisitConfirmResponseSchema,
        {
          errorMessage: "Não foi possível confirmar a presença.",
          serverErrorMessage: true,
          init: jsonInit("POST"),
        },
      );
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
      await fetchPortalJson(
        `/api/portal/visits/${visitId}/reschedule-request`,
        portalVisitRescheduleResponseSchema,
        {
          errorMessage: "Não foi possível solicitar o reagendamento.",
          serverErrorMessage: true,
          init: jsonInit("POST", {
            reason: reason.trim() === "" ? null : reason.trim(),
            preferredWindows,
          }),
        },
      );
    },
    onSuccess: invalidate,
  });
}

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
