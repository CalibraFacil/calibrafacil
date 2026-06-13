import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";

export type CalendarDueAsset = {
  id: number;
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
): Promise<CalendarResponse> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(
    `${getApiBaseUrl()}/api/portal/calendar?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Falha ao carregar o calendário");
  }
  return response.json();
}

/** Instruments coming due inside [from, to] (inclusive, YYYY-MM-DD). */
export function useCalendarDues(from: string, to: string) {
  return useQuery({
    queryKey: ["portal-calendar", from, to],
    queryFn: () => fetchCalendar(from, to),
    staleTime: 60_000,
  });
}
