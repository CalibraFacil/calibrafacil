import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy tab URL; settings are unified at /settings. Must keep resolving:
// notification e-mails link here as the unsubscribe URL
// (packages/notifications/src/service.ts).
export const Route = createFileRoute("/_authenticated/settings/notifications")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", hash: "notificacoes" });
  },
});
