import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _authDb: NeonHttpDatabase<typeof schema> | null = null;

export const getAuthDb = () => {
  if (_authDb) return _authDb;

  const connectionString = process.env.AUTH_DATABASE_URL;
  if (!connectionString)
    throw new Error("AUTH_DATABASE_URL environment variable is not set.");

  _authDb = drizzle(connectionString, { schema });
  return _authDb;
};

export const authDb = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get: (_, prop) => getAuthDb()[prop as keyof NeonHttpDatabase<typeof schema>],
});
