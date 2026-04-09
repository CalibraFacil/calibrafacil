import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsLayout,
});

function RequestsLayout() {
  return <Outlet />;
}
