// SEC-09 (#669) rework: `backoffice-users.ts` sends new-operator and
// admin-triggered password-reset emails by forwarding a synthetic request to
// a Better Auth handler. Before this fix it always forwarded to the LAB auth
// instance (`forwardLabAuthResponse` + "/api/auth/lab/request-password-reset")
// — but the lab surface is now passwordless (REQ-PWDLESS-001), so that
// forward silently died with RESET_PASSWORD_DISABLED and no backoffice
// operator could ever receive a working password-setup/reset email.
//
// This spec exercises the REAL production helpers end-to-end (real Better
// Auth handler, not a mock) to prove: (a) forwarding to the lab instance is
// still dead (regression-proof of the bug), and (b) the new
// `forwardBackofficeAuthResponse` helper — which `backoffice-users.ts` now
// uses — reaches a live endpoint instead.
import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import {
  forwardBackofficeAuthResponse,
  forwardLabAuthResponse,
} from "./backoffice-shared";

const RESET_PASSWORD_DISABLED = "RESET_PASSWORD_DISABLED";

function fakeContext() {
  return {
    req: {
      raw: new Request("http://localhost:3000/api/backoffice/users", {
        method: "POST",
      }),
    },
  };
}

async function forwardWithTimeout(
  forward: () => Promise<Response>,
): Promise<{ status: number; body: string }> {
  try {
    const res = await Promise.race([
      forward(),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("HANDLER_TIMEOUT")), 8000),
      ),
    ]);
    return { status: res.status, body: await res.text() };
  } catch (error) {
    return { status: 500, body: `THROWN:${String(error)}` };
  }
}

describe("SEC-09 backoffice password-reset forwarding", () => {
  it("REQ-PWDLESS-001 (regression proof): forwarding password-reset to the LAB auth instance is dead", async () => {
    const result = await forwardWithTimeout(() =>
      forwardLabAuthResponse({
        c: fakeContext(),
        path: "/api/auth/lab/request-password-reset",
        body: {
          email: "operador@calibrafacil.com",
          redirectTo: "http://localhost:5173/reset-password",
        },
      }),
    );

    expect(result.status).toBe(400);
    expect(result.body).toContain(RESET_PASSWORD_DISABLED);
  });

  it("REQ-PWDLESS-003: forwarding password-reset to the BACKOFFICE auth instance stays live", async () => {
    const result = await forwardWithTimeout(() =>
      forwardBackofficeAuthResponse({
        c: fakeContext(),
        path: "/api/auth/backoffice/request-password-reset",
        body: {
          email: "operador@calibrafacil.com",
          redirectTo: "http://localhost:5173/reset-password",
        },
      }),
    );

    // A live endpoint does NOT short-circuit with the disabled contract; it
    // proceeds to a (failing, no reachable DB here) user lookup instead.
    expect(result.body).not.toContain(RESET_PASSWORD_DISABLED);
  });

  // The two tests above prove the MECHANISM (lab-forward dead, backoffice-forward
  // live) but not which forwarder the operator provisioning/reset CALL SITES use —
  // forwardLabAuthResponse legitimately still exists (impersonation-stop), so a
  // future revert of backoffice-users.ts back to the lab path would stay green.
  // This source tripwire pins the call sites (SEC-09 round-2 verifier follow-up).
  it("REQ-PWDLESS-003 (call-site pin): backoffice-users.ts requests reset tokens from the BACKOFFICE auth instance only", async () => {
    const source = await readFile(
      new URL("./backoffice-users.ts", import.meta.url),
      "utf8",
    );
    const occurrences =
      source.match(/\/api\/auth\/backoffice\/request-password-reset/g) ?? [];
    // Both call sites (new-operator provisioning + admin-triggered reset).
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    // No password-reset traffic may target the (passwordless) lab instance.
    expect(source).not.toContain("/api/auth/lab/request-password-reset");
    expect(source).not.toContain("forwardLabAuthResponse");
  });
});
