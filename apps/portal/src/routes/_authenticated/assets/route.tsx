import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/assets")({
  component: AssetsLayout,
});

function AssetsLayout() {
  return <Outlet />;
}
