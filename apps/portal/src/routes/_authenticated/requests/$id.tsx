import { createFileRoute } from "@tanstack/react-router";
import { RequestDetailPage } from "@/features/requests/request-detail-page";

export const Route = createFileRoute("/_authenticated/requests/$id")({
  component: RequestDetailRoute,
});

function RequestDetailRoute() {
  const { id } = Route.useParams();

  return <RequestDetailPage id={id} />;
}
