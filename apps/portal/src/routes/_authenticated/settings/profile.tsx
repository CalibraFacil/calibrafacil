import { createFileRoute } from "@tanstack/react-router";

import { ProfileSettingsPage } from "@/features/settings/profile-page";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfileSettingsPage,
});
