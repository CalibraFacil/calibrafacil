import { Hono } from "hono";
import { createHash } from "node:crypto";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  user,
  verification,
} from "@calibra-facil/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";

/**
 * Magic-link preview — NO AUTH (gated by possession of a valid magic-link token).
 *
 * Powers the sign-in confirmation page (`/entrar` in apps/web): given a
 * magic-link token, return the target user's display info WITHOUT consuming the
 * token (a plain SELECT — never a delete). Better Auth's `/magic-link/verify`
 * GET is single-use, so an email scanner/prefetcher that fetches the raw link
 * burns the token before the user clicks. Pointing the email at a confirmation
 * page that only verifies on a real click makes sign-in prefetch-proof.
 *
 * Best-effort: any miss returns `{ found: false }` and the page falls back to a
 * generic confirmation. The actual sign-in never depends on this endpoint.
 */
export const magicLinkRouter = new Hono().get("/preview", async (c) => {
  const token = c.req.query("token");
  if (!token || token.length < 16) {
    return c.json({ found: false });
  }

  // Which surface's org to resolve: lab dashboard (LAB) or client portal.
  const organizationType =
    c.req.query("surface") === "portal" ? "CLIENT" : "LAB";

  // Better Auth stores magic-link tokens as base64url(SHA-256(token)) — see
  // better-auth `defaultKeyHasher`. Hash the same way to look the row up.
  const hashedToken = createHash("sha256").update(token).digest("base64url");

  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, hashedToken),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!record) {
    return c.json({ found: false });
  }

  const email = parseTokenEmail(record.value);
  if (!email) {
    return c.json({ found: false });
  }

  const [account] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!account) {
    return c.json({ found: false });
  }

  // The user's primary organization for this surface (oldest membership),
  // matching the active-org default applied at session creation.
  const [org] = await db
    .select({ name: organization.name, logo: organization.logo })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, account.id),
        eq(organization.type, organizationType),
      ),
    )
    .orderBy(asc(member.createdAt))
    .limit(1);

  return c.json({
    found: true,
    name: account.name,
    email: account.email,
    image: account.image,
    organizationName: org?.name ?? null,
    organizationLogo: org?.logo ?? null,
  });
});

function parseTokenEmail(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "email" in parsed &&
      typeof parsed.email === "string"
    ) {
      return parsed.email;
    }
  } catch {
    // value isn't the JSON payload we expect — treat as a miss.
  }
  return null;
}
