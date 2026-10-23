import { describe, expect, it } from "vitest";
import {
  SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_RESYNC_REQUIRED_CODE,
  buildSyncResyncRequiredResponse,
  cloudSyncEventSchema,
  compareSyncChangePositions,
  formatSyncChangeCursor,
  parseSyncChangeCursor,
  syncBootstrapPageRequestSchema,
  syncBootstrapPageResponseSchema,
  syncChangeCursorBefore,
  syncResyncRequiredResponseSchema,
} from "./index";

describe("the commit-ordered pull cursor (protocol 3)", () => {
  it("REQ-CS-1: a position round-trips through the cursor string, including xid8 values past 2^53", () => {
    const position = {
      xid: 18_446_744_073_709_551_000n,
      seq: 9_007_199_254_740_993n,
    };
    const cursor = formatSyncChangeCursor(position);
    expect(cursor).toBe("v3|18446744073709551000|9007199254740993");
    expect(parseSyncChangeCursor(cursor)).toEqual({
      kind: "position",
      position,
    });
  });

  it("REQ-CS-1: orders by transaction first and sequence second", () => {
    const low = { xid: 5n, seq: 90n };
    const high = { xid: 6n, seq: 1n };
    expect(compareSyncChangePositions(low, high)).toBe(-1);
    expect(compareSyncChangePositions(high, low)).toBe(1);
    expect(compareSyncChangePositions(low, { xid: 5n, seq: 91n })).toBe(-1);
    expect(compareSyncChangePositions(low, { ...low })).toBe(0);
  });

  it("REQ-CS-1: the cursor before an entry sorts strictly below it and nothing sorts between", () => {
    const entry = { xid: 7n, seq: 12n };
    const before = parseSyncChangeCursor(syncChangeCursorBefore(entry));
    expect(before.kind).toBe("position");
    if (before.kind !== "position") return;
    expect(before.position).toEqual({ xid: 7n, seq: 11n });
    expect(compareSyncChangePositions(before.position, entry)).toBe(-1);
    // The very first entry of a transaction: "before" is the transaction's origin.
    expect(syncChangeCursorBefore({ xid: 7n, seq: 1n })).toBe("v3|7|0");
  });

  it("REQ-CS-4: an updatedAt cursor (protocol 1 or 2) is foreign, an empty one is absent", () => {
    expect(parseSyncChangeCursor("2026-10-01T10:00:00.000Z").kind).toBe(
      "foreign",
    );
    expect(
      parseSyncChangeCursor("v2|2026-10-01T10:00:00.000Z|asset|4").kind,
    ).toBe("foreign");
    expect(parseSyncChangeCursor("cursor:batch-1:3").kind).toBe("foreign");
    expect(parseSyncChangeCursor("v3|abc|1").kind).toBe("foreign");
    expect(parseSyncChangeCursor("v3|99999999999999999999|1").kind).toBe(
      "foreign",
    );
    expect(parseSyncChangeCursor(null).kind).toBe("absent");
    expect(parseSyncChangeCursor("").kind).toBe("absent");
  });

  it("REQ-CS-4: protocol 3 is what this build speaks and it is a bump over protocol 2", () => {
    expect(SYNC_CHANGE_SEQ_PROTOCOL_VERSION).toBe(3);
    expect(SYNC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(
      SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
    );
  });

  it("REQ-CS-5: the resync answer is typed and carries its reason", () => {
    for (const reason of [
      "no_cursor",
      "cursor_format",
      "cursor_purged",
    ] as const) {
      const answer = buildSyncResyncRequiredResponse(reason);
      expect(syncResyncRequiredResponseSchema.parse(answer)).toEqual(answer);
      expect(answer.code).toBe(SYNC_RESYNC_REQUIRED_CODE);
      expect(answer.reason).toBe(reason);
    }
  });

  it("REQ-CS-2: a pulled event may carry the cursor that returns it again and an unknown type is refused", () => {
    const event = {
      cloudEventId: "cloud:asset:1:x",
      entityType: "asset",
      entityId: 1,
      operation: "delete",
      occurredAt: "2026-10-01T10:00:00.000Z",
      payload: { id: 1 },
      resumeCursor: "v3|7|11",
    };
    expect(cloudSyncEventSchema.parse(event).resumeCursor).toBe("v3|7|11");
    expect(
      cloudSyncEventSchema.safeParse({ ...event, entityType: "user" }).success,
    ).toBe(false);
  });

  it("REQ-CS-3: a bootstrap page bounds its size and always carries a cursor and a token slot", () => {
    expect(
      syncBootstrapPageRequestSchema.safeParse({ limit: 5000 }).success,
    ).toBe(false);
    expect(syncBootstrapPageRequestSchema.safeParse({ limit: 0 }).success).toBe(
      false,
    );
    expect(syncBootstrapPageRequestSchema.parse({})).toEqual({});

    const header = {
      serverTime: "2026-10-01T10:00:00.000Z",
      user: { id: "u", name: null, email: null },
      organization: { id: "o", type: "LAB" },
      activeUnits: [],
      permissions: {
        role: "admin",
        unitRole: null,
        activeUnitId: null,
        accessibleUnitIds: [],
        canAccessAllUnits: true,
      },
      featureFlags: {
        offlineApprovals: false,
        offlineCertificatePublication: false,
      },
      publishedMethods: [],
      assetTypes: [],
      customers: [],
      assets: [],
      services: [],
      standards: [],
      environmentalLimits: [],
      jobs: [],
    };
    expect(
      syncBootstrapPageResponseSchema.safeParse({
        ...header,
        syncCursor: null,
        page: { nextToken: null, rowCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      syncBootstrapPageResponseSchema.safeParse({
        ...header,
        syncCursor: "v3|10|0",
        page: { nextToken: "tok", rowCount: 0 },
      }).success,
    ).toBe(true);
  });
});
