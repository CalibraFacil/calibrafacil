/**
 * organization-lifecycle.int.spec.ts — POST /api/organization/soft-delete
 * (records retention, decision Q16, REQ-RET-3): the owner soft-deletes the
 * laboratory from the settings page. Real Postgres, real RBAC; only the
 * better-auth session is mocked.
 *
 *   REQ-RET-3  a non-owner gets 403 and nothing changes
 *   REQ-RET-3  the owner soft-deletes: who / when / why, suspended, event log
 *   REQ-RET-3  a wrong confirmation or a missing reason is a 400 with a code
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationApiKey,
  organizationEventLog,
} from "@calibra-facil/db/schema";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedApiKey, seedOrg } from "../../test/integration/seed";
import { getExecuteRows } from "../lib/db";
import { organizationLifecycleRouter } from "./organization-lifecycle";

const JSON_HEADERS = { "content-type": "application/json" };
const REASON = "Encerramento das atividades do laboratório";

function softDelete(body: unknown) {
  return organizationLifecycleRouter.request("/soft-delete", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function stateOf(orgId: string) {
  const [row] = await db
    .select({
      deletedAt: organization.deletedAt,
      deletedBy: organization.deletedBy,
      deletionReason: organization.deletionReason,
      status: organization.status,
    })
    .from(organization)
    .where(eq(organization.id, orgId));
  return row;
}

describe("POST /soft-delete — owner-only soft delete of the laboratory", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it.each(["admin", "operator", "technician", "member"] as const)(
    "REQ-RET-3 [HIGH RISK]: a %s gets 403 and the laboratory is untouched",
    async (role) => {
      const org = await seedOrg({ orgId: "org-role", role });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await softDelete({
        confirmName: "Lab org-role",
        reason: REASON,
      });

      expect(res.status).toBe(403);
      expect(await stateOf(org.orgId)).toEqual({
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        status: "ACTIVE",
      });
    },
  );

  it("REQ-RET-3 [HIGH RISK]: the owner soft-deletes the laboratory, keeping who, when and why", async () => {
    const org = await seedOrg({ orgId: "org-own", role: "owner" });
    const other = await seedOrg({ orgId: "org-other", userId: "other-owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await softDelete({
      confirmName: "Lab org-own",
      reason: REASON,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.deletedAt).toBe("string");

    const state = await stateOf(org.orgId);
    expect(state?.deletedAt).toBeInstanceOf(Date);
    expect(state).toMatchObject({
      deletedBy: org.userId,
      deletionReason: REASON,
      status: "SUSPENDED",
    });

    // The deletion is on the organization's own audit trail, with the actor.
    const [event] = await db
      .select()
      .from(organizationEventLog)
      .where(eq(organizationEventLog.organizationId, org.orgId));
    expect(event).toMatchObject({
      action: "organization.soft_deleted",
      actorUserId: org.userId,
      actorMemberId: org.memberId,
    });
    expect(event?.details).toMatchObject({ reason: REASON });

    // Another laboratory is not affected.
    expect((await stateOf(other.orgId))?.deletedAt).toBeNull();
  });

  it("REQ-RET-3: the soft delete locks the laboratory: its next request is refused, and a repeat is not a second deletion", async () => {
    const org = await seedOrg({ orgId: "org-twice", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    expect(
      (await softDelete({ confirmName: "Lab org-twice", reason: REASON }))
        .status,
    ).toBe(200);

    const again = await softDelete({
      confirmName: "Lab org-twice",
      reason: "Outro motivo qualquer",
    });

    // requireOrganization turns a suspended laboratory away before the handler.
    expect(again.status).toBe(403);
    expect((await stateOf(org.orgId))?.deletionReason).toBe(REASON);
  });

  it("REQ-RET-3 [HIGH RISK]: a wrong confirmation is a 400 with a stable code and changes nothing", async () => {
    const org = await seedOrg({ orgId: "org-confirm", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    for (const confirmName of [
      "Lab org-confirm x",
      "lab org-confirm",
      "Outra",
    ]) {
      const res = await softDelete({ confirmName, reason: REASON });
      expect(res.status, confirmName).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "organization_confirmation_mismatch",
      });
    }
    expect((await stateOf(org.orgId))?.deletedAt).toBeNull();
  });

  it.each([
    ["no reason", { confirmName: "Lab org-reason" }],
    ["a blank reason", { confirmName: "Lab org-reason", reason: "   " }],
    ["a too short reason", { confirmName: "Lab org-reason", reason: "curto" }],
    ["no confirmation", { reason: REASON }],
  ])("REQ-RET-3: %s is a 400 and changes nothing", async (_name, body) => {
    const org = await seedOrg({ orgId: "org-reason", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await softDelete(body);

    expect(res.status).toBe(400);
    expect((await stateOf(org.orgId))?.deletedAt).toBeNull();
  });

  it("REQ-RET-3: soft-deleting revokes the laboratory's API keys, and only its own", async () => {
    const org = await seedOrg({ orgId: "org-keys", role: "owner" });
    const other = await seedOrg({ orgId: "org-keys-2", userId: "other-owner" });
    await seedApiKey({
      organizationId: org.orgId,
      createdBy: org.userId,
      keyId: "key-a",
      scopes: ["customers:read"],
    });
    await seedApiKey({
      organizationId: other.orgId,
      createdBy: other.userId,
      keyId: "key-b",
      scopes: ["customers:read"],
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await softDelete({
      confirmName: "Lab org-keys",
      reason: REASON,
    });
    expect(res.status).toBe(200);

    const keys = await db
      .select({
        id: organizationApiKey.id,
        revokedAt: organizationApiKey.revokedAt,
        revokedBy: organizationApiKey.revokedBy,
      })
      .from(organizationApiKey)
      .orderBy(organizationApiKey.id);
    expect(keys.find((key) => key.id === "key-a")?.revokedAt).toBeInstanceOf(
      Date,
    );
    expect(keys.find((key) => key.id === "key-a")?.revokedBy).toBe(org.userId);
    expect(keys.find((key) => key.id === "key-b")?.revokedAt).toBeNull();
    const [audit] = getExecuteRows<{ n: number }>(
      await db.execute(
        sql`select count(*)::int as n from organization_api_key_audit_log where api_key_id = 'key-a' and action = 'revoke'`,
      ),
    );
    expect(audit?.n).toBe(1);
  });
});
