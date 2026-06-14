import { createFileRoute } from "@tanstack/react-router";

import { VerificationPage } from "@/features/verification/verification-page";

export const Route = createFileRoute("/v/$token")({
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useParams();
  return <VerificationPage token={token} />;
}
