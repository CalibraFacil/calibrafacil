import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  session as authSession,
  user,
  verification,
} from "@calibra-facil/db/schema";
import { createLabAuth } from "@calibra-facil/auth";
import { asApplicationRole } from "./application-role";

// Fixtures of the identity specs that run the REAL Better Auth lab instance as
// `calibra_app` (identity-lab-scope, identity-org-plugin-deny). The spec that
// imports this file must `vi.mock("@calibra-facil/auth", (original) => original())`
// so `createLabAuth` is the real one, not the harness's fake.

const WEB = "http://localhost:5173";
const API = "http://localhost:3000";
export const NOW = new Date("2026-02-01T00:00:00.000Z");
export const FUTURE = new Date("2099-01-01T00:00:00.000Z");

export async function seedUser(id: string, email = `${id}@lab.test`) {
  await db.insert(user).values({ id, name: `User ${id}`, email });
  return { id, email };
}

export async function seedLab(
  orgId: string,
  type: "LAB" | "CLIENT" = "LAB",
  deletedAt: Date | null = null,
) {
  await db.insert(organization).values({
    id: orgId,
    name: `Lab ${orgId}`,
    slug: orgId,
    createdAt: NOW,
    type,
    status: deletedAt ? "SUSPENDED" : "ACTIVE",
    ...(deletedAt
      ? {
          deletedAt,
          suspendedAt: deletedAt,
          suspensionReason: "test",
        }
      : {}),
  });
}

export async function seedMember(
  orgId: string,
  userId: string,
  createdAt: Date,
  role = "admin",
) {
  await db.insert(member).values({
    id: `m-${orgId}-${userId}`,
    organizationId: orgId,
    userId,
    role,
    createdAt,
  });
}

/** A magic-link verification row for `email` (Better Auth stores the token hashed). */
async function seedMagicLinkToken(email: string) {
  const token = randomBytes(24).toString("base64url");
  await db.insert(verification).values({
    id: randomBytes(8).toString("hex"),
    identifier: createHash("sha256").update(token).digest("base64url"),
    value: JSON.stringify({ email, name: "", attempt: 0 }),
    expiresAt: FUTURE,
  });
  return token;
}

/** The `Cookie` header of a Set-Cookie list. */
function cookieHeaderOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * The real sign-in: the real magic-link verify endpoint of the real lab auth
 * (creates the session, runs the session hooks), as the application role.
 */
export async function signInWithMagicLink(email: string): Promise<{
  cookie: string;
  status: number;
}> {
  const token = await seedMagicLinkToken(email);
  return asApplicationRole(async () => {
    const response = await createLabAuth().handler(
      new Request(
        `${API}/api/auth/lab/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${WEB}/dashboard`)}`,
      ),
    );
    return { cookie: cookieHeaderOf(response), status: response.status };
  });
}

export async function sessionRowFor(userId: string) {
  const [row] = await db
    .select()
    .from(authSession)
    .where(eq(authSession.userId, userId));
  return row;
}
