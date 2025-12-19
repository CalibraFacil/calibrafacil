import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authDb } from "@calibra-facil/db/auth-db";

export const auth = betterAuth({
  database: drizzleAdapter(authDb, {
    provider: "pg",
  }),
  pages: {
    signIn: "/sign-in",
  },
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? [process.env.APP1_URL, process.env.APP2_URL].filter(
          (url): url is string => Boolean(url),
        )
      : ["http://localhost:5173"],
});

export type Auth = ReturnType<typeof betterAuth>;
export type Session = Auth["$Infer"]["Session"];
