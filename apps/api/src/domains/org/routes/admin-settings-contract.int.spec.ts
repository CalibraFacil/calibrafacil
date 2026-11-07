/**
 * admin-settings-contract.int.spec.ts: the cloud half of the notifications,
 * API-keys and e-mail-domains endpoint definitions
 * (`packages/contracts/src/endpoints/{notifications,api-keys,email-domains}.ts`).
 * Every client-facing endpoint is called for real (real handlers, real
 * middleware, real Postgres) and its body is parsed with the response schema of
 * its definition. `mount` also checks each body with that schema in the
 * integration tier (`checkEndpointResponses`), so a drift fails the request
 * itself; the explicit parse here names the drifting path and the status.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const provider = vi.hoisted(() => ({
  createResendDomain: vi.fn(),
  getResendDomain: vi.fn(),
  verifyResendDomain: vi.fn(),
  deleteResendDomain: vi.fn(),
}));
vi.mock("@calibra-facil/email-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/email-sender")>()),
  ...provider,
}));

import {
  apiKeyEndpoints,
  emailDomainEndpoints,
  notificationEndpoints,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { notification } from "@calibra-facil/db/schema";
import { apiKeysRouter } from "./api-keys";
import { emailDomainsRouter } from "./email-domains";
import { notificationsRouter } from "../../notifications/routes/notifications";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const JSON_HEADERS = { "content-type": "application/json" };

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

function send(method: string, body?: unknown) {
  return {
    method,
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function seedAdmin(orgId: string) {
  const org = await seedOrg({ orgId, role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  return org;
}

describe("notifications endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list, unread count, mark read, mark all read and preferences", async () => {
    const org = await seedAdmin("org-notif-contract");
    const ids: number[] = [];
    for (const title of ["Primeira", "Segunda"]) {
      const [row] = await withStatusRepair((tx) =>
        tx
          .insert(notification)
          .values({
            recipientUserId: org.userId,
            organizationId: org.orgId,
            type: "JOB_APPROVED",
            title,
            message: `${title} mensagem`,
          })
          .returning({ id: notification.id }),
      );
      ids.push(row?.id ?? 0);
    }

    const list = await parsedBody(
      await notificationsRouter.request("/?page=1&limit=5"),
      notificationEndpoints.listRecent.response,
    );
    expect(list.data).toHaveLength(2);

    const unread = await parsedBody(
      await notificationsRouter.request("/unread-count"),
      notificationEndpoints.getUnreadCount.response,
    );
    expect(unread.count).toBe(2);

    const marked = await parsedBody(
      await notificationsRouter.request(
        "/mark-read",
        send("POST", { notificationIds: [ids[0]] }),
      ),
      notificationEndpoints.markRead.response,
    );
    expect(marked.updatedIds).toEqual([ids[0]]);

    const all = await parsedBody(
      await notificationsRouter.request("/mark-all-read", send("POST")),
      notificationEndpoints.markAllRead.response,
    );
    expect(all.count).toBe(1);

    const defaults = await parsedBody(
      await notificationsRouter.request("/preferences"),
      notificationEndpoints.getPreferences.response,
    );
    expect(defaults.emailEnabled).toBe(true);

    const created = await parsedBody(
      await notificationsRouter.request(
        "/preferences",
        send("PUT", { emailEnabled: false, digestFrequency: "DAILY" }),
      ),
      notificationEndpoints.updatePreferences.response,
    );
    expect(created).toMatchObject({ emailEnabled: false });
    const updated = await parsedBody(
      await notificationsRouter.request(
        "/preferences",
        send("PUT", { notifySelfActions: true }),
      ),
      notificationEndpoints.updatePreferences.response,
    );
    expect(updated).toMatchObject({
      notifySelfActions: true,
      digestFrequency: "DAILY",
    });
  });
});

describe("api-keys endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("create (201), list, rotate and revoke", async () => {
    await seedAdmin("org-keys-contract");

    const created = await parsedBody(
      await apiKeysRouter.request(
        "/",
        send("POST", { name: "Integração ERP", scopes: ["customers:read"] }),
      ),
      apiKeyEndpoints.create.response,
      201,
    );
    const id = created.key.id;

    const list = await parsedBody(
      await apiKeysRouter.request("/"),
      apiKeyEndpoints.list.response,
    );
    expect(list.data.map((key) => key.id)).toEqual([id]);

    const rotated = await parsedBody(
      await apiKeysRouter.request(`/${id}/rotate`, send("POST")),
      apiKeyEndpoints.rotate.response,
    );
    expect(rotated.key.keyPrefix).not.toBe(created.key.keyPrefix);

    await parsedBody(
      await apiKeysRouter.request(`/${id}/revoke`, send("POST")),
      apiKeyEndpoints.revoke.response,
    );
  });
});

describe("email-domains endpoints: real responses honor the definitions' response schemas", () => {
  const hostname = "certificados.lab.example.com";
  const details = {
    id: "rd-contract",
    name: hostname,
    status: "not_started",
    records: [
      {
        type: "TXT",
        name: "resend._domainkey",
        value: "p=test",
        status: "not_started",
      },
    ],
  };

  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("RESEND_API_KEY", "re_platform_test_key_contract");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network request");
      }),
    );
    vi.resetAllMocks();
    provider.createResendDomain.mockResolvedValue({ ok: true, data: details });
    provider.getResendDomain.mockResolvedValue({
      ok: true,
      data: { ...details, status: "verified" },
    });
    provider.verifyResendDomain.mockResolvedValue({
      ok: true,
      data: { id: details.id },
    });
    provider.deleteResendDomain.mockResolvedValue({
      ok: true,
      data: { id: details.id },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("get (none), create (201), verify, activate and delete", async () => {
    await seedAdmin("org-email-contract");

    const none = await parsedBody(
      await emailDomainsRouter.request("/"),
      emailDomainEndpoints.get.response,
    );
    expect(none.domain).toBeNull();
    expect(none.statusSummary.status).toBe("not_configured");

    const created = await parsedBody(
      await emailDomainsRouter.request(
        "/",
        send("POST", { hostname, fromLocalPart: "os" }),
      ),
      emailDomainEndpoints.create.response,
      201,
    );
    expect(created.domain?.hostname).toBe(hostname);

    const verified = await parsedBody(
      await emailDomainsRouter.request("/verify", send("POST")),
      emailDomainEndpoints.verify.response,
    );
    expect(verified.statusSummary.canActivate).toBe(true);

    const activated = await parsedBody(
      await emailDomainsRouter.request("/activate", send("POST")),
      emailDomainEndpoints.activate.response,
    );
    expect(activated.statusSummary.status).toBe("active");

    await parsedBody(
      await emailDomainsRouter.request("/", send("DELETE")),
      emailDomainEndpoints.delete.response,
    );
  });
});
