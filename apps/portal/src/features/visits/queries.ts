import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  PortalVisit,
  PortalVisitsResponse,
} from "@calibra-facil/contracts";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

export type { PortalVisit };

type PortalVisitPreferredWindow = NonNullable<
  PortalVisit["rescheduleRequest"]
>["preferredWindows"][number];

export type PortalVisitReschedulePeriod = PortalVisitPreferredWindow["period"];

function fetchVisits(): Promise<PortalVisitsResponse> {
  return portalApi.visits.list();
}

/** On-site visits scheduled for the customer (excludes cancelled). */
export function usePortalVisits() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.visits,
    queryFn: fetchVisits,
    staleTime: 60_000,
  });
}

function useInvalidateVisits() {
  const keys = usePortalKeys();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: keys.visits });
  };
}

/** #739: one-tap "Confirmar presença" on a proposed/confirmed visit. */
export function useConfirmVisitPresence() {
  const invalidate = useInvalidateVisits();
  return useMutation({
    mutationFn: async (visitId: number): Promise<void> => {
      await portalApi.visits.confirm(
        { params: { id: visitId } },
        { serverErrorMessage: true },
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
      await portalApi.visits.requestReschedule(
        {
          params: { id: visitId },
          body: {
            reason: reason.trim() === "" ? null : reason.trim(),
            preferredWindows,
          },
        },
        { serverErrorMessage: true },
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
