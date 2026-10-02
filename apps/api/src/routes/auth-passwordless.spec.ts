// SEC-09 (#669): the lab surface is passwordless by principle. These specs
// assert the composed Better Auth instances behaviorally — they hit the real
// request handler for POST <basePath>/sign-in/email and read the resolved
// options — rather than mocking the config.
//
// A password sign-in against a Better Auth instance whose emailAndPassword is
// DISABLED short-circuits with HTTP 400 + code EMAIL_PASSWORD_DISABLED *before*
// touching the database. An ENABLED instance instead proceeds to a DB lookup
// (which, with no reachable DB in this unit context, surfaces as a 5xx / a
// non-EMAIL_PASSWORD_DISABLED response). That difference is the load-bearing,
// non-tautological signal used below.
import { describe, it, expect } from "vitest";

// getDb() reads the connection string at call time. A syntactically valid but
// unreachable URL is enough: the disabled path never connects, and the enabled
// path's failed connection is exactly what distinguishes it.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { createLabAuth, createPortalAuth } from "@calibra-facil/auth";

const EMAIL_PASSWORD_DISABLED = "EMAIL_PASSWORD_DISABLED";
const RESET_PASSWORD_DISABLED = "RESET_PASSWORD_DISABLED";

async function postWithTimeout(
  auth: { handler: (req: Request) => Promise<Response> },
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  try {
    const res = await Promise.race([
      auth.handler(req),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("HANDLER_TIMEOUT")), 8000),
      ),
    ]);
    return { status: res.status, body: await res.text() };
  } catch (error) {
    // A rejected/failed DB connection on the ENABLED path lands here; it is by
    // definition NOT the disabled short-circuit.
    return { status: 500, body: `THROWN:${String(error)}` };
  }
}

function attemptPasswordSignIn(
  auth: { handler: (req: Request) => Promise<Response> },
  basePath: string,
) {
  return postWithTimeout(
    auth,
    `http://localhost:3000${basePath}/sign-in/email`,
    {
      email: "nobody@example.com",
      password: "irrelevant-password-123",
    },
  );
}

// Request phase of the password-reset flow.
function attemptRequestPasswordReset(
  auth: { handler: (req: Request) => Promise<Response> },
  basePath: string,
) {
  return postWithTimeout(
    auth,
    `http://localhost:3000${basePath}/request-password-reset`,
    {
      email: "nobody@example.com",
      redirectTo: "http://localhost:5173/reset-password",
    },
  );
}

function emailAndPasswordEnabled(auth: {
  options: { emailAndPassword?: { enabled?: boolean } };
}): boolean | undefined {
  return auth.options.emailAndPassword?.enabled;
}

function pluginIds(auth: {
  options: { plugins?: ReadonlyArray<{ id?: string }> };
}): Array<string | undefined> {
  return (auth.options.plugins ?? []).map((plugin) => plugin.id);
}

describe("SEC-09 lab passwordless auth surface", () => {
  it("REQ-PWDLESS-001: lab POST /sign-in/email is rejected (email/password disabled)", async () => {
    const lab = createLabAuth();

    // Config: the shared enabled:true must be overridden on the lab surface.
    expect(emailAndPasswordEnabled(lab)).toBe(false);

    // Behaviour: the real handler refuses the password sign-in before any DB
    // access, with the Better Auth "disabled" contract.
    const result = await attemptPasswordSignIn(lab, "/api/auth/lab");
    expect(result.status).toBe(400);
    expect(result.body).toContain(EMAIL_PASSWORD_DISABLED);

    // Password RESET is also dead on the lab surface (no sendResetPassword is
    // configured for it).
    const resetResult = await attemptRequestPasswordReset(lab, "/api/auth/lab");
    expect(resetResult.status).toBe(400);
    expect(resetResult.body).toContain(RESET_PASSWORD_DISABLED);

    // The passwordless alternatives remain wired for the lab surface.
    expect(pluginIds(lab)).toEqual(
      expect.arrayContaining(["passkey", "magic-link", "email-otp"]),
    );
  });

  it("REQ-PWDLESS-002: portal auth stays email/password disabled (regression guard)", async () => {
    const portal = createPortalAuth();

    expect(emailAndPasswordEnabled(portal)).toBe(false);

    const result = await attemptPasswordSignIn(portal, "/api/auth/portal");
    expect(result.status).toBe(400);
    expect(result.body).toContain(EMAIL_PASSWORD_DISABLED);
  });
});
