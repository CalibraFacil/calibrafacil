import { createFileRoute } from "@tanstack/react-router";

import { OutOfTolerancePage } from "@/features/out-of-tolerance/out-of-tolerance-page";

export const Route = createFileRoute("/_authenticated/out-of-tolerance/")({
  component: OutOfTolerancePage,
});
