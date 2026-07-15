import { createFileRoute } from "@tanstack/react-router";

import { AppearanceSettingsPage } from "@/features/settings/appearance-page";

export const Route = createFileRoute("/_authenticated/settings/appearance")({
  component: AppearanceSettingsPage,
});
