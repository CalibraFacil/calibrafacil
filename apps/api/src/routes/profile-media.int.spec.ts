import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileMediaRouter } from "./profile-media";
import { db } from "@calibra-facil/db";
import { user } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";

// Real-DB + real-RBAC integration tests for the profileMediaRouter.
// Only the better-auth session is mocked (see test/integration/setup.ts):
//   requireAuth tries the (REAL, unmocked) createPortalAuth().getSession first
//   -- with no portal_session cookie it resolves null -- then falls back to the
//   mocked createLabAuth().getSession. So the guard runs for real end-to-end.
//
// requireAuth is the ONLY route guard that exercises the real createPortalAuth.
// Its dev-mode baseURL is dynamic (resolved from the request Host header against
// an allowedHosts list that includes "localhost:3000"); without a matching Host
// the portal getSession throws "Dynamic baseURL could not be resolved" -> 500.
// So every test request carries Host: localhost:3000 (HOST_HEADER) -- a transport
// detail only; it changes NO production code or the shared harness/setup.ts.
//
// R2 storage calls are stubbed in-spec (vi.mock below) so no S3/R2 network is
// needed. The pure key derivation (avatarKey from @calibra-facil/shared) is NOT
// mocked and runs for real.
//
// Guard surface (apps/api/src/routes/profile-media.ts):
//   POST   /avatar -- requireAuth (any authenticated lab OR portal user)
//   GET    /avatar -- requireAuth, then reads ONLY the caller's own row via
//                     eq(user.id, session.user.id) to decide 404-vs-302-redirect
//   DELETE /avatar -- requireAuth
// There is NO org/role gate -- avatar management is self-service, scoped solely
// to the authenticated user's own user.id. (See "RBAC: N/A" note on REQ-PM-003.)
//
// Boundary proven: a request authenticated as user-A reads/serves ONLY user-A's
// avatar state; it never touches user-B's user.image. The sole discriminator is
// eq(user.id, session.user.id) in the GET handler.
//
// Proven properties:
//   REQ-PM-001 [HIGH RISK]  GET is user-scoped: user-A (no avatar) -> 404 while a
//                           seeded user-B avatar is NEVER read/leaked. Mutation of
//                           eq(user.id, session.user.id) flips user-A to a 302 leak.
//   REQ-PM-002              Unauthenticated -> 401 via the real requireAuth guard.
//   REQ-PM-003              RBAC role/org gate: N/A (self-service, no role gate) --
//                           asserted structurally as a happy-path round-trip below.
//   happy-path              upload->serve / clear round-trip toggles the user-scoped
//                           404<->302 on the caller's own user.image (storage stubbed).

// ---------------------------------------------------------------------------
// Stub the R2 storage surface -- no real S3/R2 in the test environment.
// avatarKey from @calibra-facil/shared/storage-keys is pure (no I/O) and is NOT
// mocked -- the real key derivation runs.
// ---------------------------------------------------------------------------
vi.mock("../lib/storage", () => ({
  createR2Client: () => ({}),
  uploadToR2: () => Promise.resolve(),
  deleteFromR2: () => Promise.resolve(),
  generatePresignedUrl: () => Promise.resolve("https://r2.test/signed-avatar"),
  resolveBucketName: () => "media-test",
  resolveReadBucketName: () => Promise.resolve("media-test"),
}));

// ---------------------------------------------------------------------------
// Seed helpers (inline; do not modify shared seed.ts). The avatar route needs
// only a bare `user` row -- no org/member is required by requireAuth.
// ---------------------------------------------------------------------------

/** Insert a bare user, optionally with an avatar URL stored in user.image. */
async function seedUser(params: {
  userId: string;
  image?: string | null;
}): Promise<void> {
  await db.insert(user).values({
    id: params.userId,
    name: `User ${params.userId}`,
    email: `${params.userId}@lab.test`,
    image: params.image ?? null,
  });
}

/** Read the persisted user.image for a userId (null if unset / no row). */
async function imageOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.image ?? null;
}

/** Build a multipart FormData body with file field "avatar". */
function makeAvatarFormData(contentType = "image/png"): FormData {
  const form = new FormData();
  const file = new File([Buffer.alloc(64, 1)], "avatar.png", {
    type: contentType,
  });
  form.append("avatar", file);
  return form;
}

// user-B's private avatar URL -- the sole-discriminator leak row.
const AVATAR_LEAK_URL = "https://r2.test/USER-B-PRIVATE-AVATAR";

// Host header that satisfies the portal auth's dev-mode allowedHosts so the real
// createPortalAuth().getSession can resolve its dynamic baseURL (then returns
// null -- no portal cookie -- and requireAuth falls through to the lab session).
const HOST_HEADER: Record<string, string> = { Host: "localhost:3000" };

describe("profileMediaRouter -- real DB + real requireAuth middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-PM-001 [HIGH RISK]: user isolation on GET /avatar.
  // user-A has NO avatar (image=null); user-B has a stored avatar (the leak row).
  // A request as user-A must read ONLY user-A's row -> 404, and must NEVER read
  // or serve user-B's avatar. The discriminator is eq(user.id, session.user.id).
  // =========================================================================
  it(
    "REQ-PM-001: GET /avatar as user-A (no avatar) -> 404; user-B's stored avatar is never read or leaked (user-scoped via eq(user.id, session.user.id))",
    async () => {
      // user-B is the sole-discriminator leak row: it HAS an avatar.
      await seedUser({ userId: "user-pm-001-b", image: AVATAR_LEAK_URL });
      // user-A is the caller and has NO avatar.
      await seedUser({ userId: "user-pm-001-a", image: null });

      loginAs({
        userId: "user-pm-001-a",
        organizationId: "org-pm-001",
      });

      const res = await profileMediaRouter.request("/avatar", {
        method: "GET",
        headers: HOST_HEADER,
      });

      // user-A has no avatar of their own -> 404. If the scope were broken (the
      // mutation: drop/neutralize eq(user.id, session.user.id)), user-A would
      // resolve user-B's image row and get a 302 redirect instead -> RED here.
      expect(res.status).toBe(404);

      const body = await res.json();
      const raw = JSON.stringify(body);
      // Must NOT expose any redirect/presigned URL or user-B's private avatar.
      expect(raw).not.toContain(AVATAR_LEAK_URL);
      expect(raw).not.toContain("https://r2.test/signed-avatar");
      expect(res.headers.get("location")).toBeNull();

      // The handler is read-only on user.image; user-B's avatar is untouched.
      expect(await imageOf("user-pm-001-b")).toBe(AVATAR_LEAK_URL);
    },
  );

  // =========================================================================
  // REQ-PM-002: unauthenticated -> 401 via the real requireAuth guard.
  // logout() nulls the lab session; with no portal_session cookie the real
  // portal getSession also resolves null -> requireAuth throws 401.
  // =========================================================================
  it(
    "REQ-PM-002: GET /avatar without authentication -> 401 (requireAuth fires before the handler)",
    async () => {
      logout();
      const res = await profileMediaRouter.request("/avatar", {
        method: "GET",
        headers: HOST_HEADER,
      });
      expect(res.status).toBe(401);
    },
  );

  it(
    "REQ-PM-002b: DELETE /avatar without authentication -> 401",
    async () => {
      logout();
      const res = await profileMediaRouter.request("/avatar", {
        method: "DELETE",
        headers: HOST_HEADER,
      });
      expect(res.status).toBe(401);
    },
  );

  // =========================================================================
  // happy-path: serve/clear round-trip is user-scoped to the caller's own
  // user.image. When user-A has an avatar configured -> GET 302 (presigned,
  // stubbed); when cleared -> GET 404. The 404<->302 hinge is the caller's own
  // image column, never another user's. DELETE -> 200 (storage stubbed).
  // =========================================================================
  it(
    "happy-path: GET /avatar -> 302 when the caller's own user.image is set; -> 404 once cleared; DELETE /avatar -> 200",
    async () => {
      // A co-tenant user-B with an avatar exists throughout to prove user-A's
      // 302/404 outcome is driven by user-A's OWN image, not any other user's.
      await seedUser({ userId: "user-pm-hp-b", image: AVATAR_LEAK_URL });
      await seedUser({
        userId: "user-pm-hp-a",
        image: "https://r2.test/USER-A-OWN-AVATAR",
      });

      loginAs({ userId: "user-pm-hp-a", organizationId: "org-pm-hp" });

      // user-A HAS an avatar -> presigned redirect (storage stubbed).
      const served = await profileMediaRouter.request("/avatar", {
        method: "GET",
        headers: HOST_HEADER,
      });
      expect(served.status).toBe(302);
      expect(served.headers.get("location")).toBe(
        "https://r2.test/signed-avatar",
      );

      // DELETE -> 200 success (R2 delete stubbed; handler is best-effort).
      const deleted = await profileMediaRouter.request("/avatar", {
        method: "DELETE",
        headers: HOST_HEADER,
      });
      expect(deleted.status).toBe(200);
      const deletedBody = await deleted.json();
      expect("success" in deletedBody && deletedBody.success).toBe(true);

      // Now clear user-A's own image column (the GET 404-vs-302 discriminator).
      await db
        .update(user)
        .set({ image: null })
        .where(eq(user.id, "user-pm-hp-a"));

      const afterClear = await profileMediaRouter.request("/avatar", {
        method: "GET",
        headers: HOST_HEADER,
      });
      // No avatar for the caller -> 404, even though user-B's avatar still exists.
      expect(afterClear.status).toBe(404);
      const afterBody = await afterClear.json();
      expect(JSON.stringify(afterBody)).not.toContain(AVATAR_LEAK_URL);

      // user-B's avatar was never read, served, or mutated by user-A's requests.
      expect(await imageOf("user-pm-hp-b")).toBe(AVATAR_LEAK_URL);
    },
  );

  it(
    "happy-path: POST /avatar with a valid PNG -> 200 returns the avatar API URL (upload stubbed)",
    async () => {
      await seedUser({ userId: "user-pm-up-a", image: null });
      loginAs({ userId: "user-pm-up-a", organizationId: "org-pm-up" });

      const res = await profileMediaRouter.request("/avatar", {
        method: "POST",
        headers: HOST_HEADER,
        body: makeAvatarFormData("image/png"),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect("imageUrl" in body && typeof body.imageUrl === "string").toBe(true);
      if ("imageUrl" in body && typeof body.imageUrl === "string") {
        expect(body.imageUrl).toContain("/api/profile-media/avatar");
      }
    },
  );
});
