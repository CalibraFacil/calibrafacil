import { createFileRoute } from "@tanstack/react-router";

import { PublicQuotePage } from "@/features/public-access/public-quote-page";

export const Route = createFileRoute("/service-order-access/$token")({
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useParams();
  return <PublicQuotePage token={token} />;
}
