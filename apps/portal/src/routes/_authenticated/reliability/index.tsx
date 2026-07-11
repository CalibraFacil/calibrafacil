import { createFileRoute } from "@tanstack/react-router";

import { ReliabilityPage } from "@/features/reliability/reliability-page";

export const Route = createFileRoute("/_authenticated/reliability/")({
  component: ReliabilityPage,
});
