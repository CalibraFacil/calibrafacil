import { createFileRoute } from "@tanstack/react-router";

import { NotificationSettingsPage } from "@/features/notifications/settings-page";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotificationSettingsPage,
});
