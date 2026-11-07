import { createFileRoute } from "@tanstack/react-router";
import { ServiceOrderDetailPage } from "@/features/service-orders/service-order-detail-page";

export const Route = createFileRoute("/_authenticated/service-orders/$id")({
  component: ServiceOrderDetailRoute,
});

function ServiceOrderDetailRoute() {
  const { id } = Route.useParams();

  return <ServiceOrderDetailPage id={id} />;
}
