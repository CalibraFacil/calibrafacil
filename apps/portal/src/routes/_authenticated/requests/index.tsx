import { createFileRoute } from "@tanstack/react-router";
import {
  CALIBRATION_REQUEST_STATUS,
  type CalibrationRequestStatus,
} from "@calibra-facil/schemas/machines";
import { RequestsPage } from "@/features/requests/requests-page";

type RequestsSearch = {
  status?: CalibrationRequestStatus;
};

export const Route = createFileRoute("/_authenticated/requests/")({
  validateSearch: (search: Record<string, unknown>): RequestsSearch => {
    const status = CALIBRATION_REQUEST_STATUS.parse(search.status);
    return status ? { status } : {};
  },
  component: RequestsRoute,
});

function RequestsRoute() {
  const { status: initialStatus } = Route.useSearch();

  return <RequestsPage status={initialStatus} />;
}
