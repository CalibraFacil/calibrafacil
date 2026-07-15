import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy tab URL; settings are unified at /settings.
export const Route = createFileRoute("/_authenticated/settings/appearance")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", hash: "aparencia" });
  },
});
