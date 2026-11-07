import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AcceptInvitePage } from "@/features/invitations/accept-invite-page";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/accept-invite")({
  validateSearch: searchSchema,
  component: AcceptInviteRoute,
});

function AcceptInviteRoute() {
  const { token } = Route.useSearch();

  return <AcceptInvitePage token={token} />;
}
