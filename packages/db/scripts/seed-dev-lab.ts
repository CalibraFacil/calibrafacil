/**
 * Development seed: a demo laboratory you can sign in to right away.
 *
 *   bun packages/db/scripts/seed-dev-lab.ts        (run by `pnpm setup:dev`)
 *
 * Creates (idempotently — safe to run again):
 *   - the portal service account (PORTAL_SERVICE_USER_ID=portal-service),
 *   - "Laboratório Demonstração" with its default unit,
 *   - three members, so flows that need two people (e.g. method review and
 *     approval) can be exercised:
 *       admin@laboratorio.test    owner
 *       revisor@laboratorio.test  admin
 *       tecnico@laboratorio.test  technician
 *
 * Sign-in is passwordless: request a magic link at http://localhost:5173 and
 * open it from the local inbox at http://localhost:8025.
 *
 * Refuses to run against anything but a local database.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import { member, organization, organizationUnit, user } from "../src/schema";

const LAB_ID = "demo-lab";
const PORTAL_SERVICE_USER_ID = "portal-service";

const DEMO_USERS = [
  {
    id: "demo-admin",
    name: "Ana Administradora",
    email: "admin@laboratorio.test",
    role: "owner",
  },
  {
    id: "demo-reviewer",
    name: "Rui Revisor",
    email: "revisor@laboratorio.test",
    role: "admin",
  },
  {
    id: "demo-technician",
    name: "Tina Técnica",
    email: "tecnico@laboratorio.test",
    role: "technician",
  },
] as const;

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (see packages/db/.env.example)");
  }

  const { hostname } = new URL(databaseUrl);
  const isLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(
    hostname,
  );
  if (!isLocal && !process.argv.includes("--allow-remote")) {
    throw new Error(
      `Refusing to seed demo data into ${hostname}. This seed is for local development only (pass --allow-remote to override).`,
    );
  }
}

async function ensureUser(values: { id: string; name: string; email: string }) {
  await db
    .insert(user)
    .values({
      id: values.id,
      name: values.name,
      email: values.email,
      emailVerified: true,
    })
    .onConflictDoNothing();
}

async function seed() {
  assertLocalDatabase();
  const now = new Date();

  await ensureUser({
    id: PORTAL_SERVICE_USER_ID,
    name: "Conta de serviço do portal",
    email: "portal-service@calibra.test",
  });
  for (const demoUser of DEMO_USERS) {
    await ensureUser(demoUser);
  }

  await db
    .insert(organization)
    .values({
      id: LAB_ID,
      name: "Laboratório Demonstração",
      slug: "laboratorio-demonstracao",
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
      cnpj: "11.222.333/0001-81",
    })
    .onConflictDoNothing();

  const existingUnit = await db.query.organizationUnit.findFirst({
    where: and(
      eq(organizationUnit.organizationId, LAB_ID),
      eq(organizationUnit.isDefault, true),
    ),
  });
  if (!existingUnit) {
    await db.insert(organizationUnit).values({
      organizationId: LAB_ID,
      name: "Matriz",
      slug: "matriz",
      status: "ACTIVE",
      isDefault: true,
      createdBy: DEMO_USERS[0].id,
    });
  }

  for (const demoUser of DEMO_USERS) {
    await db
      .insert(member)
      .values({
        id: `member-${LAB_ID}-${demoUser.id}`,
        organizationId: LAB_ID,
        userId: demoUser.id,
        role: demoUser.role,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  console.log("Demo laboratory ready:");
  for (const demoUser of DEMO_USERS) {
    console.log(`  ${demoUser.email.padEnd(28)} ${demoUser.role}`);
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Dev seed failed:", error);
    process.exit(1);
  });
