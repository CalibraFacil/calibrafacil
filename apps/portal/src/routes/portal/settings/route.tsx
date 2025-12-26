import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/portal/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return <Outlet />;
}
