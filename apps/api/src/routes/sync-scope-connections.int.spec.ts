/**
 * sync-scope-connections.int.spec.ts: nothing that runs inside an event's
 * transaction may open a second database connection (D1).
 *
 * `create_local_customer` (a legacy event an older build may still hold) creates
 * a client organization through better-auth, whose adapter takes its own
 * connection. Inside the event's transaction that deadlocks when the pool is
 * small (Vercel's default is one connection), and what it wrote survived a
 * rollback of the event. The organization is now created before the
 * transaction, idempotently on the event id, and the transaction only
 * references it.
 *
 * Unlike sync-organization-id.int.spec.ts this spec does NOT mock
 * portal-service-account, and it runs the pool at ONE connection. The real lab
 * better-auth instance is used for createOrganization (the harness stubs it to
 * getSession only); its getSession stays the harness mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { customer, organization } from "@calibra-facil/db/schema";
import {
  classifyOutboxRejection,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { failEventAuditInsert } from "../../test/integration/sync-faults";
import { ensurePortalServiceUser } from "../lib/portal-service-account";
import { desktopCustomerSlug, syncRouter } from "./sync";

vi.mock("@calibra-facil/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calibra-facil/auth")>();
  const { labGetSessionMock } = await import("../../test/integration/setup");
  return {
    ...actual,
    createLabAuth: () => {
      const real = actual.createLabAuth();
      return { ...real, api: { ...real.api, getSession: labGetSessionMock } };
    },
  };
});

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const ORG = "org-conn";
const USER = "user-conn";
const SLUG_PREFIX = "cliente-pool-um-ltda-";
// Far below the test timeout: a deadlock must fail here, not at the 60 s limit.
const PUSH_DEADLINE_MS = 20_000;

type Org = Awaited<ReturnType<typeof seedOrg>>;

function customerEvent(org: Org, eventId: string) {
  return {
    eventId,
    entityType: "customer",
    entityId: `local-${eventId}`,
    operation: "create_local_customer",
    payload: { name: "Cliente Pool Um Ltda" },
    occurredAt: new Date().toISOString(),
    actorUserId: USER,
    organizationId: ORG,
    unitId: org.unitId,
    idempotencyKey: `idem-${eventId}`,
    localVersion: 0,
  };
}

async function push(org: Org, event: Record<string, unknown>) {
  loginAs({ userId: USER, organizationId: ORG });
  const response = await Promise.race([
    syncRouter.request("/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-active-unit-id": String(org.unitId),
      },
      body: JSON.stringify({
        deviceId: "device-conn",
        clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
        baseCursor: null,
        events: [event],
      }),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("push did not finish: deadlocked")),
        PUSH_DEADLINE_MS,
      ),
    ),
  ]);
  expect(response.status).toBe(200);
  return syncPushResponseSchema.parse(await response.json());
}

async function clientOrganizations() {
  return db
    .select({ id: organization.id, type: organization.type })
    .from(organization)
    .where(like(organization.slug, `${SLUG_PREFIX}%`));
}

describe("an event's transaction opens no second connection (D1)", () => {
  beforeEach(async () => {
    vi.stubEnv("DATABASE_POOL_MAX", "1");
    vi.stubEnv("PORTAL_SERVICE_USER_ID", "portal-service-conn");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(48));
    await truncateAll();
    await ensurePortalServiceUser();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("D1 [HIGH RISK]: with the pool at ONE connection and the real organization creation, a legacy create_local_customer completes (no deadlock) and references the organization created for it", async () => {
    const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });

    const body = await push(org, customerEvent(org, "evt-conn-ok"));

    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    const orgs = await clientOrganizations();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.type).toBe("CLIENT");
    const [created] = await db
      .select({ authOrganizationId: customer.authOrganizationId })
      .from(customer)
      .where(eq(customer.labOrganizationId, ORG));
    expect(created?.authOrganizationId).toBe(orgs[0]?.id);
  }, 60_000);

  it("D1 [HIGH RISK]: when the event's transaction rolls back, the organization created for it is reused on the retry, not duplicated", async () => {
    const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
    const restore = await failEventAuditInsert("evt-conn-retry");
    let first: Awaited<ReturnType<typeof push>>;
    try {
      first = await push(org, customerEvent(org, "evt-conn-retry"));
    } finally {
      await restore();
    }

    expect(first.accepted).toEqual([]);
    expect(first.rejected).toEqual([
      expect.objectContaining({ code: "DESKTOP_SYNC_APPLY_FAILED" }),
    ]);
    expect(
      await db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.labOrganizationId, ORG)),
    ).toEqual([]);
    const afterFailure = await clientOrganizations();
    expect(afterFailure).toHaveLength(1);

    const retry = await push(org, customerEvent(org, "evt-conn-retry"));

    expect(retry.rejected).toEqual([]);
    expect(retry.accepted).toHaveLength(1);
    expect(await clientOrganizations()).toEqual(afterFailure);
    const [created] = await db
      .select({ authOrganizationId: customer.authOrganizationId })
      .from(customer)
      .where(eq(customer.labOrganizationId, ORG));
    expect(created?.authOrganizationId).toBe(afterFailure[0]?.id);
  }, 60_000);

  it("D1: a retried push of an event that already applied creates no organization", async () => {
    const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
    const event = customerEvent(org, "evt-conn-again");
    await push(org, event);
    const before = await clientOrganizations();

    const again = await push(org, event);

    expect(again.accepted).toHaveLength(1);
    expect(await clientOrganizations()).toEqual(before);
  }, 60_000);

  describe("an organization that merely has the expected slug is not adopted (D8)", () => {
    const EVENT = "evt-conn-squat";
    const NAME = "Cliente Pool Um Ltda";

    async function squat(params: {
      slug: string;
      type: "CLIENT" | "LAB";
      metadata: unknown;
    }) {
      await db.insert(organization).values({
        id: "org-victim-client",
        name: "Cliente da Vitima",
        slug: params.slug,
        type: params.type,
        status: "ACTIVE",
        metadata:
          params.metadata === null ? null : JSON.stringify(params.metadata),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
    }

    async function pushSquatted(org: Org) {
      const body = await push(org, customerEvent(org, EVENT));
      const created = await db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.labOrganizationId, ORG));
      return { body, created };
    }

    it("D8: the digest is 128 bits and the slug stays within 63 characters", () => {
      const slug = desktopCustomerSlug(
        "Um Cliente Com Um Nome Muito Muito Longo Mesmo Para Testar O Limite",
        ORG,
        EVENT,
      );

      expect(slug.length).toBeLessThanOrEqual(63);
      expect(slug).toMatch(/-[0-9a-f]{32}$/);
      expect(desktopCustomerSlug(NAME, ORG, EVENT)).toBe(
        desktopCustomerSlug(NAME, ORG, EVENT),
      );
      expect(desktopCustomerSlug(NAME, ORG, EVENT)).not.toBe(
        desktopCustomerSlug(NAME, "another-lab", EVENT),
      );
    });

    it.each([
      ["has no creation metadata at all", null],
      [
        "was created for another laboratory",
        { desktopSync: { laboratoryId: "org-other-lab", eventId: EVENT } },
      ],
      [
        "was created for another event of this laboratory",
        { desktopSync: { laboratoryId: ORG, eventId: "evt-other" } },
      ],
    ] as const)(
      "D8 [HIGH RISK]: an existing client organization with the expected slug that %s is refused for good, and no customer is linked to it",
      async (_label, metadata) => {
        const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
        await squat({
          slug: desktopCustomerSlug(NAME, ORG, EVENT),
          type: "CLIENT",
          metadata,
        });

        const { body, created } = await pushSquatted(org);

        expect(body.accepted).toEqual([]);
        expect(body.rejected).toEqual([
          expect.objectContaining({
            eventId: EVENT,
            code: "DOMAIN_VALIDATION_FAILED",
            reason: expect.stringContaining("organizacao"),
          }),
        ]);
        expect(classifyOutboxRejection(body.rejected[0]?.code ?? "")).toBe(
          "permanent",
        );
        expect(created).toEqual([]);
      },
    );

    it("D8 [HIGH RISK]: an organization of this event that another laboratory's customer already references is refused", async () => {
      const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
      await seedOrg({ orgId: "org-other-lab", userId: "user-other-lab" });
      await squat({
        slug: desktopCustomerSlug(NAME, ORG, EVENT),
        type: "CLIENT",
        metadata: { desktopSync: { laboratoryId: ORG, eventId: EVENT } },
      });
      await db.insert(customer).values({
        name: "Cliente de outro laboratorio",
        authOrganizationId: "org-victim-client",
        labOrganizationId: "org-other-lab",
      });

      const { body, created } = await pushSquatted(org);

      expect(body.accepted).toEqual([]);
      expect(body.rejected[0]?.code).toBe("DOMAIN_VALIDATION_FAILED");
      expect(created).toEqual([]);
    });

    it("D8: an organization that is not a CLIENT is refused", async () => {
      const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });
      await squat({
        slug: desktopCustomerSlug(NAME, ORG, EVENT),
        type: "LAB",
        metadata: { desktopSync: { laboratoryId: ORG, eventId: EVENT } },
      });

      const { body, created } = await pushSquatted(org);

      expect(body.rejected[0]?.code).toBe("DOMAIN_VALIDATION_FAILED");
      expect(created).toEqual([]);
    });

    it("D8: the organization this event created is stamped with its laboratory and event, so the retry recognises it", async () => {
      const org = await seedOrg({ orgId: ORG, userId: USER, role: "admin" });

      await push(org, customerEvent(org, EVENT));

      const [created] = await db
        .select({ metadata: organization.metadata })
        .from(organization)
        .where(eq(organization.slug, desktopCustomerSlug(NAME, ORG, EVENT)));
      expect(JSON.parse(created?.metadata ?? "null")).toMatchObject({
        desktopSync: { laboratoryId: ORG, eventId: EVENT },
      });
    }, 60_000);
  });
});
