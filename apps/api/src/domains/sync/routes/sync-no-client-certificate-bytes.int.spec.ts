/**
 * REQ-P01-4: no code path publishes client-rendered certificate bytes.
 *
 * Approval and certificates are online-only: `certificate_url` only gets a value
 * when the worker renders and signs the PDF after `approveJob`. The desktop
 * publish path (`POST /sync/certificate-pdfs` / the `publish_desktop_certificate`
 * operation) accepted bytes whose hash and size were checked only against
 * metadata from the same client; it must stay gone. Tested where a client meets
 * it: the real router and the real push.
 */
import { CURRENT_DESKTOP_BUILD } from "../../../../test/integration/desktop-build";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncPushResponseSchema } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { syncAppliedEvent } from "@calibra-facil/db/schema";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { syncRouter } from "./";

vi.mock("../../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

describe("REQ-P01-4: a desktop cannot publish certificate bytes", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("has no certificate-pdfs route", async () => {
    const org = await seedOrg({ orgId: "org-no-bytes", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/certificate-pdfs", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });

    expect(res.status).toBe(404);
  });

  it("refuses a push event that asks to publish a certificate, and applies nothing", async () => {
    const org = await seedOrg({ orgId: "org-no-bytes-push", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-active-unit-id": String(org.unitId),
      },
      body: JSON.stringify({
        deviceId: "device-no-bytes",
        clientBatchId: "batch-no-bytes",
        baseCursor: null,
        ...CURRENT_DESKTOP_BUILD,
        events: [
          {
            eventId: "evt-publish-1",
            entityType: "calibration_job",
            entityId: "local-1",
            operation: "publish_desktop_certificate",
            payload: {
              certificatePdfBase64: "JVBERi0=",
              sha256: "0".repeat(64),
            },
            occurredAt: new Date().toISOString(),
            actorUserId: org.userId,
            organizationId: org.orgId,
            unitId: org.unitId,
            idempotencyKey: "idem-publish-1",
            localVersion: 0,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = syncPushResponseSchema.parse(await res.json());
    expect(body.accepted).toEqual([]);
    expect(body.rejected.map((item) => item.code)).toEqual([
      "UNSUPPORTED_SYNC_OPERATION",
    ]);
    expect(await db.select().from(syncAppliedEvent)).toEqual([]);
  });
});
