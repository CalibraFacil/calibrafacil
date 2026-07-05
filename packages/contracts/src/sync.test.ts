import { describe, expect, it } from "vitest";
import { syncEventSchema } from "./sync";

const baseEvent = {
  eventId: "event:1",
  entityType: "customer",
  entityId: "customer:123",
  operation: "update_local_customer",
  payload: { name: "Edited" },
  occurredAt: "2026-01-15T10:05:00.000Z",
  actorUserId: "user-1",
  organizationId: "org-1",
  unitId: 1,
  idempotencyKey: "local:event:1",
  localVersion: 0,
};

describe("syncEventSchema baseUpdatedAt (REL-01)", () => {
  it("REQ-REL-SYNC-104: accepts an event WITHOUT baseUpdatedAt (legacy desktop builds)", () => {
    const result = syncEventSchema.safeParse(baseEvent);
    expect(result.success).toBe(true);
  });

  it("REQ-REL-SYNC-104: accepts an event WITH a baseUpdatedAt ISO string", () => {
    const result = syncEventSchema.safeParse({
      ...baseEvent,
      baseUpdatedAt: "2026-01-15T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUpdatedAt).toBe("2026-01-15T09:00:00.000Z");
    }
  });

  it("REQ-REL-SYNC-104: accepts an event WITH a null baseUpdatedAt (never-pulled row)", () => {
    const result = syncEventSchema.safeParse({
      ...baseEvent,
      baseUpdatedAt: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUpdatedAt).toBeNull();
    }
  });
});
