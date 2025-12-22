import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { organization } from "better-auth/plugins";
import { ac, roles } from "./access";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      // New members get read-only access by default
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defaultMemberRole: "member" as any,
      // Organization creator gets full control
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      creatorRole: "owner" as any,
    }),
  ],
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? [process.env.APP1_URL, process.env.APP2_URL].filter(
          (url): url is string => Boolean(url),
        )
      : ["http://localhost:5173"],
});

export type Auth = ReturnType<typeof betterAuth>;
export type Session = Auth["$Infer"]["Session"];
