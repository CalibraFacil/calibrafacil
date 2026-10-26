/**
 * auth-routes.int.spec.ts - architecture review P0-1 [HIGH RISK].
 *
 * Better Auth's organization plugin let any signed-in user, a portal customer
 * included, `POST /api/auth/{lab,portal}/organization/create` with `type: "LAB"`
 * and self-asserted accreditation fields, bypassing public sign-up. Three layers
 * now refuse it, each pinned here with the REAL Better Auth instances, REAL
 * sessions and the REAL mount (`mountAuthRoutes`), as `calibra_app`:
 *
 *   REQ-P01-1  The mount exposes an explicit allowlist per surface: organization
 *              create, delete and member-role endpoints, admin/*, SSO provider
 *              registration, account linking and user deletion are 404, for a
 *              lab member, a lab owner and a portal customer alike; nothing is
 *              created.
 *   REQ-P01-2  Behind the mount, the plugin itself refuses a signed-in user's
 *              creation (403), so a future mount change cannot reopen it.
 *   REQ-P01-3  The endpoints the apps use still work through the mount (session,
 *              organization list / full / set-active, update, passkey list,
 *              sessions, update-user, sign-out, magic-link verify).
 *   REQ-P01-4  `organization/update` still renames a laboratory but can no longer
 *              set type, CNPJ or the accreditation claim.
 *   REQ-P01-5  An organization is created only inside `provisionOrganization`:
 *              outside it the hook refuses; inside it the creation attributes
 *              are written; a CLIENT organization needs the portal service user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { member, organization } from "@calibra-facil/db/schema";
import {
  createLabAuth,
  createPortalAuth,
  provisionOrganization,
} from "@calibra-facil/auth";
import { truncateAll } from "../../test/integration/db";
import { asApplicationRole } from "../../test/integration/application-role";
import { inSequence } from "../../test/integration/in-sequence";
import {
  seedLab,
  seedMember,
  seedUser,
  sessionRowFor,
  signInWithMagicLink,
  signInWithPortalMagicLink,
} from "../../test/integration/identity-fixtures";
import { mountAuthRoutes } from "./auth-routes";
import type { Env } from "./env";

// The REAL Better Auth instances (the harness's fakes only have `getSession`).
vi.mock("@calibra-facil/auth", async (importOriginal) => importOriginal());

const WEB = "http://localhost:5173";
const PORTAL = "http://localhost:5174";

function mounted() {
  const app = new Hono<{ Bindings: Env }>();
  mountAuthRoutes(app);
  return app;
}

type Surface = "lab" | "portal";

function call(
  app: ReturnType<typeof mounted>,
  surface: Surface,
  method: "GET" | "POST",
  path: string,
  options: { cookie?: string; body?: unknown } = {},
) {
  return asApplicationRole(async () =>
    app.request(`/api/auth/${surface}${path}`, {
      method,
      headers: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        origin: surface === "lab" ? WEB : PORTAL,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST"
        ? { body: JSON.stringify(options.body ?? {}) }
        : {}),
    }),
  );
}

async function organizationCount() {
  return (await db.select({ id: organization.id }).from(organization)).length;
}

const CREATE_BODY = {
  name: "Lab Pirata",
  slug: "lab-pirata",
  type: "LAB",
  cnpj: "11222333000181",
  accreditationActive: true,
  accreditationNumber: "CAL 0999",
  accreditationBody: "Cgcre",
  accreditationValidFrom: "2026-01-01T00:00:00.000Z",
  accreditationValidUntil: "2099-01-01T00:00:00.000Z",
};

describe("Better Auth mount and organization plugin (P0-1)", () => {
  let labCookie: string;
  let ownerCookie: string;
  let portalCookie: string;

  beforeEach(async () => {
    await truncateAll();
    const member1 = await seedUser("lab-member");
    const owner1 = await seedUser("lab-owner");
    const customer = await seedUser("portal-customer");
    await seedLab("lab-a");
    await seedLab("client-org", "CLIENT");
    await seedMember("lab-a", member1.id, new Date("2021-01-01"), "member");
    await seedMember("lab-a", owner1.id, new Date("2021-02-01"), "owner");
    await seedMember(
      "client-org",
      customer.id,
      new Date("2021-03-01"),
      "client_user",
    );
    labCookie = (await signInWithMagicLink(member1.email)).cookie;
    ownerCookie = (await signInWithMagicLink(owner1.email)).cookie;
    portalCookie = (await signInWithPortalMagicLink(customer.email)).cookie;
    expect(labCookie).toContain("lab.session_token");
    expect(portalCookie).toContain("portal.session_token");
  });

  it("REQ-P01-1: organization create is 404 through the mount for a lab member, a lab owner and a portal customer; nothing is created", async () => {
    const app = mounted();
    const before = await organizationCount();

    const statuses = await inSequence(
      [
        ["lab", labCookie],
        ["lab", ownerCookie],
        ["portal", portalCookie],
      ] as const,
      async ([surface, cookie]) =>
        (
          await call(app, surface, "POST", "/organization/create", {
            cookie,
            body: CREATE_BODY,
          })
        ).status,
    );
    expect(statuses).toEqual([404, 404, 404]);

    expect(await organizationCount()).toBe(before);
    expect(
      await db
        .select()
        .from(organization)
        .where(eq(organization.slug, "lab-pirata")),
    ).toEqual([]);
  });

  it("REQ-P01-1: every endpoint no surface calls is 404 with a valid session, on both surfaces", async () => {
    const app = mounted();
    const denied: Array<["GET" | "POST", string]> = [
      ["POST", "/organization/create"],
      ["POST", "/organization/delete"],
      ["POST", "/organization/update-member-role"],
      ["POST", "/organization/leave"],
      ["POST", "/organization/check-slug"],
      ["POST", "/organization/has-permission"],
      ["GET", "/organization/get-invitation"],
      ["GET", "/organization/list-user-invitations"],
      ["GET", "/admin/list-users"],
      ["GET", "/admin/get-user"],
      ["POST", "/admin/set-role"],
      ["POST", "/admin/create-user"],
      ["POST", "/admin/ban-user"],
      ["POST", "/admin/impersonate-user"],
      ["POST", "/sso/register"],
      ["POST", "/sso/delete-provider"],
      ["GET", "/sso/providers"],
      ["POST", "/sign-in/sso"],
      ["GET", "/sso/saml2/sp/metadata"],
      ["POST", "/sign-in/email"],
      ["POST", "/sign-up/email"],
      ["POST", "/link-social"],
      ["GET", "/list-accounts"],
      ["POST", "/delete-user"],
      ["POST", "/change-email"],
      ["POST", "/request-password-reset"],
      ["POST", "/reset-password"],
      ["POST", "/revoke-session"],
    ];

    const attempts = (["lab", "portal"] as const).flatMap((surface) =>
      denied.map(([method, path]) => ({ surface, method, path })),
    );
    const statuses = await inSequence(
      attempts,
      async ({ surface, method, path }) =>
        (
          await call(app, surface, method, path, {
            cookie: surface === "lab" ? ownerCookie : portalCookie,
            body: {},
          })
        ).status,
    );
    expect(
      Object.fromEntries(
        attempts.map((attempt, index) => [
          `${attempt.surface} ${attempt.method} ${attempt.path}`,
          statuses[index],
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        attempts.map((attempt) => [
          `${attempt.surface} ${attempt.method} ${attempt.path}`,
          404,
        ]),
      ),
    );
  });

  it("REQ-P01-1: the portal does not expose the lab-only endpoints that the lab surface allows", async () => {
    const app = mounted();
    const labOnly: Array<["GET" | "POST", string]> = [
      ["POST", "/organization/update"],
      ["POST", "/organization/invite-member"],
      ["POST", "/organization/remove-member"],
      ["GET", "/organization/list-members"],
      ["GET", "/list-sessions"],
      ["POST", "/sign-in/email-otp"],
      ["GET", "/passkey/list-user-passkeys"],
    ];
    const statuses = await inSequence(
      labOnly,
      async ([method, path]) =>
        (await call(app, "portal", method, path, { cookie: portalCookie }))
          .status,
    );
    expect(statuses).toEqual(labOnly.map(() => 404));
  });

  it("REQ-P01-2: behind the mount the plugin refuses a signed-in user's creation (403) and creates nothing", async () => {
    const before = await organizationCount();

    // The Better Auth handlers WITHOUT the allowlist in front of them.
    const attempts: Array<{
      surface: Surface;
      handler: (request: Request) => Promise<Response>;
      cookie: string;
    }> = [
      {
        surface: "lab",
        handler: (request) => createLabAuth().handler(request),
        cookie: labCookie,
      },
      {
        surface: "lab",
        handler: (request) => createLabAuth().handler(request),
        cookie: ownerCookie,
      },
      {
        surface: "portal",
        handler: (request) => createPortalAuth().handler(request),
        cookie: portalCookie,
      },
    ];
    const statuses = await inSequence(
      attempts,
      ({ surface, handler, cookie }) =>
        asApplicationRole(
          async () =>
            (
              await handler(
                new Request(
                  `http://localhost:3000/api/auth/${surface}/organization/create`,
                  {
                    method: "POST",
                    headers: {
                      cookie,
                      origin: surface === "lab" ? WEB : PORTAL,
                      "content-type": "application/json",
                    },
                    body: JSON.stringify(CREATE_BODY),
                  },
                ),
              )
            ).status,
        ),
    );
    expect(statuses).toEqual([403, 403, 403]);

    expect(await organizationCount()).toBe(before);
  });

  it("REQ-P01-3: the endpoints the apps call still work through the mount", async () => {
    const app = mounted();

    const session = await call(app, "lab", "GET", "/get-session", {
      cookie: ownerCookie,
    });
    expect(session.status).toBe(200);
    expect((await session.json()).user.id).toBe("lab-owner");

    const list = await call(app, "lab", "GET", "/organization/list", {
      cookie: ownerCookie,
    });
    expect(list.status).toBe(200);
    expect((await list.json()).map((org: { id: string }) => org.id)).toEqual([
      "lab-a",
    ]);

    const active = await call(
      app,
      "lab",
      "GET",
      "/organization/get-full-organization",
      { cookie: ownerCookie },
    );
    expect(active.status).toBe(200);
    expect((await active.json()).id).toBe("lab-a");

    const setActive = await call(
      app,
      "lab",
      "POST",
      "/organization/set-active",
      {
        cookie: ownerCookie,
        body: { organizationId: "lab-a" },
      },
    );
    expect(setActive.status).toBe(200);

    const members = await call(
      app,
      "lab",
      "GET",
      "/organization/list-members",
      {
        cookie: ownerCookie,
      },
    );
    expect(members.status).toBe(200);

    const passkeys = await call(
      app,
      "lab",
      "GET",
      "/passkey/list-user-passkeys",
      { cookie: ownerCookie },
    );
    expect(passkeys.status).toBe(200);
    expect(await passkeys.json()).toEqual([]);

    const sessions = await call(app, "lab", "GET", "/list-sessions", {
      cookie: ownerCookie,
    });
    expect(sessions.status).toBe(200);

    const rename = await call(app, "lab", "POST", "/update-user", {
      cookie: ownerCookie,
      body: { name: "Dona do Lab" },
    });
    expect(rename.status).toBe(200);

    const portalSession = await call(app, "portal", "GET", "/get-session", {
      cookie: portalCookie,
    });
    expect(portalSession.status).toBe(200);
    expect((await portalSession.json()).user.id).toBe("portal-customer");

    const portalList = await call(app, "portal", "GET", "/organization/list", {
      cookie: portalCookie,
    });
    expect(portalList.status).toBe(200);
    expect(
      (await portalList.json()).map((org: { id: string }) => org.id),
    ).toEqual(["client-org"]);

    const portalSetActive = await call(
      app,
      "portal",
      "POST",
      "/organization/set-active",
      { cookie: portalCookie, body: { organizationId: "client-org" } },
    );
    expect(portalSetActive.status).toBe(200);

    const signOut = await call(app, "lab", "POST", "/sign-out", {
      cookie: ownerCookie,
    });
    expect(signOut.status).toBe(200);
    // The session row is gone (the 5-minute cookie cache may still answer a
    // stale cookie; the row is what sign-out destroys).
    expect(await sessionRowFor("lab-owner")).toBeUndefined();
  });

  it("REQ-P01-4: organization/update renames the laboratory but cannot set type, CNPJ or the accreditation claim", async () => {
    const app = mounted();

    const res = await call(app, "lab", "POST", "/organization/update", {
      cookie: ownerCookie,
      body: {
        organizationId: "lab-a",
        data: {
          name: "Lab A renomeado",
          type: "CLIENT",
          cnpj: "11222333000181",
          accreditationActive: true,
          accreditationNumber: "CAL 0999",
          accreditationBody: "Cgcre",
          accreditationValidUntil: "2099-01-01T00:00:00.000Z",
          technicalManagerName: "Fulano",
        },
      },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, "lab-a"));
    expect(row?.name).toBe("Lab A renomeado");
    expect(row?.type).toBe("LAB");
    expect(row?.cnpj).toBeNull();
    expect(row?.accreditationActive).toBe(false);
    expect(row?.accreditationNumber).toBeNull();
    expect(row?.accreditationBody).toBeNull();
    expect(row?.accreditationValidUntil).toBeNull();
    expect(row?.technicalManagerName).toBeNull();
  });
});

const body = (slug: string, userId: string) => ({
  name: `Org ${slug}`,
  slug,
  userId,
  keepCurrentActiveOrganization: true,
});

describe("organization creation is a platform provisioning flow (P0-1)", () => {
  const previousServiceUser = process.env.PORTAL_SERVICE_USER_ID;

  beforeEach(async () => {
    await truncateAll();
    await seedUser("owner-1");
    await seedUser("service-user");
  });

  afterEach(() => {
    if (previousServiceUser === undefined)
      delete process.env.PORTAL_SERVICE_USER_ID;
    else process.env.PORTAL_SERVICE_USER_ID = previousServiceUser;
  });

  it("REQ-P01-5: a server call outside provisionOrganization is refused and creates nothing", async () => {
    const refusal = await asApplicationRole(() =>
      createLabAuth().api.createOrganization({ body: body("fora", "owner-1") }),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refusal).not.toBeNull();
    expect(Reflect.get(refusal ?? {}, "statusCode")).toBe(403);
    expect(await organizationCount()).toBe(0);
  });

  it("REQ-P01-5: provisionOrganization creates a LAB with its attributes and the creator as owner", async () => {
    const created = await asApplicationRole(() =>
      provisionOrganization(
        {
          type: "LAB",
          cnpj: "11222333000181",
          phone: "11999990000",
          email: "contato@lab.test",
        },
        () =>
          createLabAuth().api.createOrganization({
            body: body("lab-novo", "owner-1"),
          }),
      ),
    );

    const [row] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, created.id));
    expect(row).toMatchObject({
      slug: "lab-novo",
      type: "LAB",
      cnpj: "11222333000181",
      phone: "11999990000",
      email: "contato@lab.test",
      accreditationActive: false,
      accreditationNumber: null,
    });
    const [owner] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, created.id));
    expect(owner?.role).toBe("owner");
  });

  it("REQ-P01-5: a CLIENT organization needs the portal service user", async () => {
    process.env.PORTAL_SERVICE_USER_ID = "service-user";

    const refusal = await asApplicationRole(() =>
      provisionOrganization({ type: "CLIENT" }, () =>
        createLabAuth().api.createOrganization({
          body: body("cliente-intruso", "owner-1"),
        }),
      ),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).not.toBeNull();
    expect(Reflect.get(refusal ?? {}, "statusCode")).toBe(403);
    expect(await organizationCount()).toBe(0);

    const created = await asApplicationRole(() =>
      provisionOrganization({ type: "CLIENT" }, () =>
        createLabAuth().api.createOrganization({
          body: body("cliente-ok", "service-user"),
        }),
      ),
    );
    const [row] = await db
      .select({ type: organization.type })
      .from(organization)
      .where(eq(organization.id, created.id));
    expect(row?.type).toBe("CLIENT");
  });
});
