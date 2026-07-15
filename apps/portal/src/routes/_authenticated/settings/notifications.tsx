import { createFileRoute } from "@tanstack/react-router";

import { NotificationPreferencesSection } from "@/features/notifications/preferences-section";

// Also the unsubscribe URL in notification e-mails
// (packages/notifications/src/service.ts).
export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotificationPreferencesSection,
});
