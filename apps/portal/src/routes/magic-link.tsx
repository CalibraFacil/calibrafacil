import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MagicLinkPage } from "@/features/auth/magic-link-page";

const searchSchema = z.object({
  token: z.string().optional(),
  callbackURL: z.string().optional(),
});

export const Route = createFileRoute("/magic-link")({
  validateSearch: searchSchema,
  component: MagicLinkRoute,
});

function MagicLinkRoute() {
  const { token, callbackURL } = Route.useSearch();

  return <MagicLinkPage token={token} callbackURL={callbackURL} />;
}
