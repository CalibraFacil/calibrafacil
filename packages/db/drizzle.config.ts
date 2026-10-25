import { defineConfig } from "drizzle-kit";
import "dotenv/config";

// drizzle-kit (db:migrate, db:studio) changes the schema, so it connects as the
// table OWNER: DATABASE_OWNER_URL when set (the application's DATABASE_URL is the
// restricted calibra_app role), else DATABASE_URL (packages/db/.env, the owner).
const url = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is not set in the .env file");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url,
  },
});
