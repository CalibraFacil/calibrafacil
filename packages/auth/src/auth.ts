import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [organization()],
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? [process.env.APP1_URL, process.env.APP2_URL].filter(
          (url): url is string => Boolean(url),
        )
      : ["http://localhost:5173"],
});

export type Auth = ReturnType<typeof betterAuth>;
export type Session = Auth["$Infer"]["Session"];
