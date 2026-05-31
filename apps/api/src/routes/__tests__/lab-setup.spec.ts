import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { labSetupRouter } from "../lab-setup";

const mocks = vi.hoisted(() => ({
  validateLabAccountSetupToken: vi.fn(),
  buildLabClaimUrl: vi.fn((appUrl: string, token: string) => {
    const url = new URL("/claim-account", appUrl);
    url.searchParams.set("token", token);
    return url.toString();
  }),
  signInMagicLink: vi.fn(),
  sendVerificationOTP: vi.fn(),
  getSession: vi.fn(),
  dbInsert: vi.fn(),
  dbInsertValues: vi.fn(),
}));

vi.mock("@calibra-facil/auth", () => ({
  createLabAuth: () => ({
    api: {
      signInMagicLink: mocks.signInMagicLink,
      sendVerificationOTP: mocks.sendVerificationOTP,
      getSession: mocks.getSession,
    },
  }),
}));

vi.mock("@calibra-facil/auth/lab-access", () => ({
  buildLabClaimUrl: mocks.buildLabClaimUrl,
  normalizeLabAccessEmail: (email: string) => email.trim().toLowerCase(),
  validateLabAccountSetupToken: mocks.validateLabAccountSetupToken,
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    insert: mocks.dbInsert,
  },
}));

function createApp(env: Record<string, string> = {}) {
  return {
    request(path: string, init?: RequestInit) {
      return new Hono()
        .route("/api/lab-setup", labSetupRouter)
        .request(`/api/lab-setup${path}`, init, env);
    },
  };
}

function validToken(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: "ready",
    token: {
      id: "setup-token-id",
      userId: "user-1",
      organizationId: "org-1",
      invitationId: "invitation-1",
      email: "owner@lab.test",
      purpose: "member_invite_claim",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      organizationName: "Lab Acreditado",
      organizationSlug: "lab-acreditado",
      hasMembership: false,
      ...overrides,
    },
  };
}

describe("labSetupRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbInsert.mockReturnValue({ values: mocks.dbInsertValues });
    mocks.dbInsertValues.mockResolvedValue(undefined);
    mocks.signInMagicLink.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    mocks.sendVerificationOTP.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  it.each([
    ["invalid", 404],
    ["expired", 410],
    ["consumed", 410],
  ])(
    "returns %s token status metadata for rejected setup links",
    async (status, httpStatus) => {
      mocks.validateLabAccountSetupToken.mockResolvedValue({
        ok: false,
        status,
      });

      const response = await createApp().request(`/${status}-token`);

      expect(response.status).toBe(httpStatus);
      await expect(response.json()).resolves.toEqual({
        status,
        passkeyPreferred: true,
        fallbackMethods: ["magic_link", "email_otp"],
      });
      expect(mocks.dbInsert).not.toHaveBeenCalled();
    },
  );

  it("sends magic links only after token validation and uses the trusted app URL", async () => {
    mocks.validateLabAccountSetupToken.mockResolvedValue(validToken());

    const response = await createApp({
      APP_URL: "https://web.calibrafacil.test",
    }).request("/raw.setup.token/request-magic-link", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: "owner@lab.test",
          callbackURL:
            "https://web.calibrafacil.test/claim-account?token=raw.setup.token",
          errorCallbackURL:
            "https://web.calibrafacil.test/claim-account?token=raw.setup.token",
          metadata: {
            setupToken: "raw.setup.token",
          },
        },
      }),
    );
    expect(mocks.buildLabClaimUrl).toHaveBeenCalledWith(
      "https://web.calibrafacil.test",
      "raw.setup.token",
    );
    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lab_account.magic_link_requested",
        entityId: "setup-token-id",
        details: {
          organizationId: "org-1",
          invitationId: "invitation-1",
        },
      }),
    );
  });

  it("rejects claim completion when the authenticated user does not match the setup token", async () => {
    mocks.validateLabAccountSetupToken.mockResolvedValue(validToken());
    mocks.getSession.mockResolvedValue({
      user: {
        id: "other-user",
        email: "owner@lab.test",
      },
      session: {
        id: "session-1",
      },
    });

    const response = await createApp().request("/raw.setup.token/complete", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Sessão não corresponde ao convite",
    });
    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lab_account.claim_failed",
        targetUserId: "user-1",
        entityId: "setup-token-id",
        details: expect.objectContaining({
          reason: "session_user_mismatch",
          sessionUserId: "other-user",
          organizationId: "org-1",
        }),
      }),
    );
  });
});
