import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { CalendarPage } from "@/features/calendar/calendar-page";

type CalendarSearch = {
  /** Visible month as "YYYY-MM"; absent means the current month. */
  month?: string;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const Route = createFileRoute("/_authenticated/calendar/")({
  validateSearch: (search: Record<string, unknown>): CalendarSearch => ({
    month:
      typeof search.month === "string" && MONTH_PATTERN.test(search.month)
        ? search.month
        : undefined,
  }),
  component: CalendarRoute,
});

function CalendarRoute() {
  const { month } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <CalendarPage
      month={month}
      onMonthChange={(value) => {
        void navigate({
          to: "/calendar",
          search: { month: value },
          replace: true,
        });
      }}
    />
  );
}
