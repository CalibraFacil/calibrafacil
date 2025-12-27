import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/portal/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/settings/appearance" });
  },
});
