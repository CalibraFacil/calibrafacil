import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignInPage } from "@/features/auth/sign-in-page";

const searchSchema = z.object({
  redirect: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: searchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect, error: magicLinkError } = Route.useSearch();

  return <SignInPage redirect={redirect} magicLinkError={magicLinkError} />;
}
