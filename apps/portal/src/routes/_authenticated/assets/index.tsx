import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FleetPage } from "@/features/fleet/fleet-page";
import {
  type CalibrationFilter,
  isCalibrationFilter,
} from "@/lib/calibration-status";

type AssetsSearch = {
  dueStatus?: CalibrationFilter;
};

export const Route = createFileRoute("/_authenticated/assets/")({
  validateSearch: (search: Record<string, unknown>): AssetsSearch => ({
    dueStatus: isCalibrationFilter(search.dueStatus)
      ? search.dueStatus
      : undefined,
  }),
  component: AssetsRoute,
});

function AssetsRoute() {
  const { dueStatus } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <FleetPage
      dueStatus={dueStatus}
      onDueStatusChange={(value) => {
        void navigate({
          to: "/assets",
          search: { dueStatus: value },
          replace: true,
        });
      }}
    />
  );
}
