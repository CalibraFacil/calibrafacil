import { useQuery } from "@tanstack/react-query";

import { portalCalendarResponseSchema } from "@calibra-facil/contracts";

import { fetchPortalJson } from "@/lib/api-fetch";
import { usePortalQueryKey } from "@/lib/portal-org-context";

export type CalendarDueAsset = {
  id: number;
  publicId: string;
  name: string;
  tag: string;
  assetTypeName: string;
  nextCalibrationDate: string;
  inLab: boolean;
};

type CalendarResponse = {
  data: Array<CalendarDueAsset>;
};

async function fetchCalendar(
  from: string,
  to: string,
  unitId?: number,
): Promise<CalendarResponse> {
  const params = new URLSearchParams({ from, to });
  if (unitId) params.set("unitId", String(unitId));
  return fetchPortalJson(
    `/api/portal/calendar?${params.toString()}`,
    portalCalendarResponseSchema,
    { errorMessage: "Falha ao carregar o calendário" },
  );
}

/** Instruments coming due inside [from, to] (inclusive, YYYY-MM-DD). */
export function useCalendarDues(from: string, to: string, unitId?: number) {
  const key = usePortalQueryKey();
  return useQuery({
    queryKey: key("portal-calendar", from, to, unitId ?? null),
    queryFn: () => fetchCalendar(from, to, unitId),
    staleTime: 60_000,
  });
}
