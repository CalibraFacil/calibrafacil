import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/portal/assets")({
  component: AssetsLayout,
});

function AssetsLayout() {
  return <Outlet />;
}
