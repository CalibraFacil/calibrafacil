import { createFileRoute } from "@tanstack/react-router";
import { ServiceOrdersPage } from "@/features/service-orders/service-orders-page";

export const Route = createFileRoute("/_authenticated/service-orders/")({
  component: ServiceOrdersRoute,
});

function ServiceOrdersRoute() {
  return <ServiceOrdersPage />;
}
