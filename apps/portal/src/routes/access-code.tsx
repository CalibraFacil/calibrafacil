import { createFileRoute } from "@tanstack/react-router";

import { CodeEntryPage } from "@/features/public-access/code-entry-page";

export const Route = createFileRoute("/access-code")({
  component: CodeEntryPage,
});
