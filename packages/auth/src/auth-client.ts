import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";

export const authClient = createBetterAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
