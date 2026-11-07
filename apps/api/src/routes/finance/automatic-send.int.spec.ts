/**
 * automatic-send.int.spec.ts — Real-DB + real-RBAC integration tests for the
 * automatic-send rule settings (POST /settings/automatic-send/).
 *
 * Only the better-auth session is mocked (see test/integration/setup.ts).
 * RBAC guards and all SQL run against the real test Postgres, including the
 * partial unique index that allows one organization-wide default rule.
 *
 * Proven properties (oracle):
 *   REQ-AUTOSEND-001  One org-wide default rule per organization: a second
 *                     default POST → 409 with a pt-BR error (the 23505 on
 *                     automatic_send_rule_org_default_uidx, not a 500); a scoped
 *                     rule alongside the default → 200; concurrent first defaults
 *                     → exactly one 200 and one 409.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { financeAutomaticSendRouter } from "./automatic-send";
import { db } from "@calibra-facil/db";
import { automaticSendRule } from "@calibra-facil/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

describe("financeAutomaticSendRouter — org-default uniqueness (real DB)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-AUTOSEND-001: second org-wide default rule → 409 (pt-BR); scoped rule alongside the default → 200", async () => {
    const org = await seedOrg({
      orgId: "org-autosend-409",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const postRule = (body: Record<string, unknown>) =>
      financeAutomaticSendRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });

    const first = await postRule({ milestone: "certificate_approved" });
    expect(first.status).toBe(200);

    const second = await postRule({ milestone: "service_order_delivered" });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe(
      "Já existe uma regra padrão para a organização",
    );

    const scoped = await postRule({
      milestone: "service_order_delivered",
      serviceCategory: "calibracao-dimensional",
    });
    expect(scoped.status).toBe(200);

    const defaults = await db
      .select({ id: automaticSendRule.id })
      .from(automaticSendRule)
      .where(
        and(
          eq(automaticSendRule.organizationId, org.orgId),
          isNull(automaticSendRule.customerId),
          isNull(automaticSendRule.commercialAgreementId),
          isNull(automaticSendRule.serviceCategory),
          isNull(automaticSendRule.archivedAt),
        ),
      );
    expect(defaults).toHaveLength(1);
  });

  it("REQ-AUTOSEND-001: two concurrent first org-wide defaults → exactly one 200 and one 409 (race-safe)", async () => {
    const org = await seedOrg({
      orgId: "org-autosend-race",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const attempt = () =>
      financeAutomaticSendRouter.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ milestone: "certificate_approved" }),
      });
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const rows = await db
      .select({ id: automaticSendRule.id })
      .from(automaticSendRule)
      .where(eq(automaticSendRule.organizationId, org.orgId));
    expect(rows).toHaveLength(1);
  });
});
