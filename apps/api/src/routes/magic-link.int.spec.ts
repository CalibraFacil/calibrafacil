import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { magicLinkRouter } from "./magic-link";
import { db } from "@calibra-facil/db";
import { member, organization, user, verification } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";

// Real-DB integration tests for the magic-link PREVIEW endpoint.
//
// The router is intentionally UNAUTHENTICATED — it is gated only by possession
// of a valid magic-link token. There is no better-auth session here, so the
// getSession mock in test/integration/setup.ts is irrelevant to this surface;
// the whole security boundary lives in the handler's WHERE clauses against REAL
// Postgres, which is exactly what this tier proves.
//
// REAL contract discovered (do not invent):
//   - Route: GET /preview?token=<raw>&surface=<lab|portal>  (magic-link.ts).
//   - Better Auth (auth.ts → magicLink({ storeToken: "hashed" })) stores the
//     verification row as:
//         identifier = base64url(SHA-256(rawToken))    (unpadded)
//         value      = JSON.stringify({ email, name })
//         expiresAt  = now + 10min
//     (verified against better-auth@1.6.14 magic-link/index.mjs + utils.mjs
//      defaultKeyHasher; Node's createHash(..).digest("base64url") is unpadded
//      base64url, identical to better-auth's base64Url.encode(.., {padding:false}).)
//   - The preview handler hashes the raw ?token the SAME way and does a plain
//     SELECT (never a delete/consume) filtered by expiresAt > now. A hit returns
//     the bound user + their oldest org membership for the requested surface
//     (LAB unless surface=portal → CLIENT). Any miss → { found: false }.
//   - This handler does NOT consume the token. Single-use consumption is owned
//     by better-auth's own GET /magic-link/verify, which is mounted on the
//     better-auth instance, not this Hono router. See the unreachable-path flag
//     at the bottom of this file.
//
// Proven properties:
//   REQ-ML-001 [HIGH RISK] valid token → correct bound user/lab, row NOT consumed
//   REQ-ML-002 [HIGH RISK] unknown/invalid token → { found: false }, no info leak
//   REQ-ML-003 happy-path preview round-trip returns the documented shape;
//              also: expired token is rejected, and surface selects the right org.

// ---------------------------------------------------------------------------
// Token + verification-row helpers — reproduce EXACTLY what better-auth writes
// when it stores a hashed magic-link token. The route is responsible for hashing
// the raw token back to this identifier; the test only ever holds the RAW token.
// ---------------------------------------------------------------------------

/** Better-auth uses a 32-char a-zA-Z token; any high-entropy raw token works. */
function rawMagicToken(): string {
  return randomBytes(24).toString("base64url"); // 32 url-safe chars, length >= 16
}

/** Mirror better-auth `defaultKeyHasher`: unpadded base64url(SHA-256(token)). */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("base64url");
}

/**
 * Insert a verification row exactly as better-auth's magic-link plugin would
 * (storeToken: "hashed"). Returns the raw token the caller puts on the URL.
 */
async function seedMagicToken(params: {
  email: string;
  name?: string;
  expiresAt?: Date;
  /** Override the stored identifier to simulate a hash mismatch (negative case). */
  identifierOverride?: string;
}): Promise<string> {
  const rawToken = rawMagicToken();
  const identifier = params.identifierOverride ?? hashToken(rawToken);
  await db.insert(verification).values({
    id: `ver-${randomBytes(6).toString("hex")}`,
    identifier,
    value: JSON.stringify({ email: params.email, name: params.name ?? null }),
    expiresAt:
      params.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000), // +10min
  });
  return rawToken;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** Seed a user + an org of the given type + a membership joining them. */
async function seedUserWithOrg(params: {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  orgType: "LAB" | "CLIENT";
  orgLogo?: string | null;
  memberCreatedAt?: Date;
}): Promise<void> {
  await db.insert(user).values({
    id: params.userId,
    name: params.name,
    email: params.email,
    image: `https://cdn.test/${params.userId}.png`,
  });
  await db.insert(organization).values({
    id: params.orgId,
    name: params.orgName,
    slug: params.orgId,
    createdAt: NOW,
    type: params.orgType,
    status: "ACTIVE",
    logo: params.orgLogo ?? null,
  });
  await db.insert(member).values({
    id: `member-${params.orgId}-${params.userId}`,
    organizationId: params.orgId,
    userId: params.userId,
    role: "admin",
    createdAt: params.memberCreatedAt ?? NOW,
  });
}

describe("magicLinkRouter (GET /preview) — real DB security boundary", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-ML-001 [HIGH RISK]: a valid token's preview returns the correct bound
  // user/lab WITHOUT consuming the token (the verification row survives intact).
  // =========================================================================
  it(
    "REQ-ML-001: preview of a valid token returns the bound user + lab org and does NOT consume the row",
    async () => {
      await seedUserWithOrg({
        userId: "u-ana",
        email: "ana@exemplo.test",
        name: "Ana Metrologista",
        orgId: "lab-exemplo",
        orgName: "Laboratório Exemplo",
        orgType: "LAB",
        orgLogo: "https://cdn.test/exemplo-logo.png",
      });
      const rawToken = await seedMagicToken({
        email: "ana@exemplo.test",
        name: "Ana Metrologista",
      });

      // Snapshot the row BEFORE preview so we can prove it is untouched after.
      const before = await db
        .select()
        .from(verification)
        .where(eq(verification.identifier, hashToken(rawToken)));
      expect(before).toHaveLength(1);

      const res = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(rawToken)}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      // Correct bound identity resolved via the token-hash lookup.
      expect(body.found).toBe(true);
      expect(body.email).toBe("ana@exemplo.test");
      expect(body.name).toBe("Ana Metrologista");
      expect(body.image).toBe("https://cdn.test/u-ana.png");
      expect(body.organizationName).toBe("Laboratório Exemplo");
      expect(body.organizationLogo).toBe("https://cdn.test/exemplo-logo.png");

      // PREFETCH-SAFE: the verification row is still present + byte-identical.
      // A delete/consume here is the bug this whole endpoint exists to avoid.
      const after = await db
        .select()
        .from(verification)
        .where(eq(verification.identifier, hashToken(rawToken)));
      expect(after).toHaveLength(1);
      expect(after[0]?.value).toBe(before[0]?.value);
      expect(after[0]?.expiresAt.getTime()).toBe(
        before[0]?.expiresAt.getTime(),
      );

      // ---- Mutation proof (token-hash lookup): if the stored identifier did
      // NOT equal base64url(SHA-256(rawToken)), the SAME request would miss.
      // This proves the PASS above depends on the real hash, not on the row's
      // mere existence (no tautology).
      await db.delete(verification);
      await seedMagicToken({
        email: "ana@exemplo.test",
        name: "Ana Metrologista",
        identifierOverride: `wrong-${hashToken(rawToken)}`,
      });
      const mutated = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(rawToken)}`,
      );
      expect((await mutated.json()).found).toBe(false);
    },
  );

  // =========================================================================
  // REQ-ML-002 [HIGH RISK]: unknown / invalid token → rejected, no info leak.
  // =========================================================================
  it(
    "REQ-ML-002: unknown, too-short, and missing tokens are rejected with no bound info leaked",
    async () => {
      // A real user + token exist in the DB; the attacker just doesn't have it.
      await seedUserWithOrg({
        userId: "u-secret",
        email: "secret@lab.test",
        name: "Secret User",
        orgId: "lab-secret",
        orgName: "Secret Lab",
        orgType: "LAB",
      });
      await seedMagicToken({ email: "secret@lab.test", name: "Secret User" });

      // (a) An unknown high-entropy token that was never stored → miss.
      const unknown = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(rawMagicToken())}`,
      );
      expect(unknown.status).toBe(200);
      const unknownBody = await unknown.json();
      expect(unknownBody.found).toBe(false);
      expect(unknownBody).not.toHaveProperty("email");
      expect(unknownBody).not.toHaveProperty("name");
      expect(unknownBody).not.toHaveProperty("organizationName");

      // (b) Too-short token is rejected before any DB lookup.
      const tooShort = await magicLinkRouter.request("/preview?token=short");
      expect((await tooShort.json()).found).toBe(false);

      // (c) Missing token param → miss.
      const missing = await magicLinkRouter.request("/preview");
      expect((await missing.json()).found).toBe(false);

      // ---- Mutation proof: feeding the REAL raw token (the one secret@lab.test
      // actually owns) DOES resolve. This proves cases (a)-(c) reject because
      // the token is absent/invalid, not because the route always returns false.
      const realToken = await seedMagicToken({
        email: "secret@lab.test",
        name: "Secret User",
      });
      const valid = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(realToken)}`,
      );
      const validBody = await valid.json();
      expect(validBody.found).toBe(true);
      expect(validBody.email).toBe("secret@lab.test");
    },
  );

  // =========================================================================
  // REQ-ML-003 (happy-path): documented shape + expiry guard + surface routing.
  // =========================================================================
  it(
    "REQ-ML-003: preview returns the documented shape, rejects expired tokens, and honours the surface param",
    async () => {
      // --- Documented happy-path shape on a portal (CLIENT) surface ---
      await seedUserWithOrg({
        userId: "u-cli",
        email: "cliente@portal.test",
        name: "Cliente Portal",
        orgId: "client-acme",
        orgName: "ACME Indústria",
        orgType: "CLIENT",
        orgLogo: null,
      });
      const portalToken = await seedMagicToken({
        email: "cliente@portal.test",
        name: "Cliente Portal",
      });

      const portalRes = await magicLinkRouter.request(
        `/preview?surface=portal&token=${encodeURIComponent(portalToken)}`,
      );
      expect(portalRes.status).toBe(200);
      const portalBody = await portalRes.json();
      expect(portalBody).toStrictEqual({
        found: true,
        name: "Cliente Portal",
        email: "cliente@portal.test",
        image: "https://cdn.test/u-cli.png",
        organizationName: "ACME Indústria",
        organizationLogo: null,
      });

      // --- Surface routing: a LAB-surface preview for a user whose ONLY org is
      // CLIENT resolves the user but leaves organizationName null (no LAB org). ---
      const labSurfaceRes = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(
          await seedMagicToken({
            email: "cliente@portal.test",
            name: "Cliente Portal",
          }),
        )}`,
      );
      const labSurfaceBody = await labSurfaceRes.json();
      expect(labSurfaceBody.found).toBe(true);
      expect(labSurfaceBody.email).toBe("cliente@portal.test");
      expect(labSurfaceBody.organizationName).toBeNull();

      // --- Expiry guard: an already-expired (but present) token → miss ---
      await seedUserWithOrg({
        userId: "u-exp",
        email: "expired@lab.test",
        name: "Expired User",
        orgId: "lab-exp",
        orgName: "Expired Lab",
        orgType: "LAB",
      });
      const expiredToken = await seedMagicToken({
        email: "expired@lab.test",
        name: "Expired User",
        expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
      });
      const expiredRes = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(expiredToken)}`,
      );
      expect((await expiredRes.json()).found).toBe(false);

      // Mutation proof for the expiry guard: the SAME token, re-stored with a
      // future expiry, resolves — so the miss above is the expiry filter, not a
      // bad hash.
      await db.delete(verification);
      const refreshed = await seedMagicToken({
        email: "expired@lab.test",
        name: "Expired User",
        identifierOverride: hashToken(expiredToken),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      expect(refreshed).toBeTypeOf("string");
      const reRes = await magicLinkRouter.request(
        `/preview?token=${encodeURIComponent(expiredToken)}`,
      );
      expect((await reRes.json()).found).toBe(true);
    },
  );

  // =========================================================================
  // UNREACHABLE-PATH FLAG (single-use verify / consumption):
  //
  // The verify-then-consume step is NOT in magicLinkRouter. Better Auth owns
  // GET /magic-link/verify on its own auth instance (auth.ts → magicLink()),
  // which is what burns the single-use token. That handler is mounted via the
  // better-auth wildcard, not on this Hono router, and the integration harness
  // mocks ONLY createLabAuth().api.getSession — the verify route itself is not
  // exercisable here without standing up the full better-auth runtime.
  //
  // What this file DOES prove about single-use, via DB-observable state:
  //   - preview is a pure read: it NEVER consumes/deletes the row (REQ-ML-001),
  //     which is the property that keeps the single-use token alive for the real
  //     verify click (the prefetch-safety guarantee).
  //   - the expiry filter (REQ-ML-003) is the same WHERE clause that bounds a
  //     token's validity window.
  // The act of consumption itself belongs to a better-auth integration test.
  // =========================================================================
});
