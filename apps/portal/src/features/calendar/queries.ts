import { useQuery } from "@tanstack/react-query";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

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
  return portalApi.dashboard.calendar({ query: { from, to, unitId } });
}

/** Instruments coming due inside [from, to] (inclusive, YYYY-MM-DD). */
export function useCalendarDues(from: string, to: string, unitId?: number) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.calendar(from, to, unitId),
    queryFn: () => fetchCalendar(from, to, unitId),
    staleTime: 60_000,
  });
}
