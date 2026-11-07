import { describe, expect, it } from "vitest";
import { cloudSyncEventSchema, syncBootstrapResponseSchema } from "./sync";
import {
  SYNC_ENTITIES,
  SYNC_ENTITY_ORDER,
  SYNC_PARTITION_DOMAIN_ENTITIES,
  SYNC_SKIPPED_ROW_KINDS,
  isSyncEntity,
  isSyncSkippedRowKind,
  syncChangeLogTables,
  syncMirrorLiveCondition,
  syncMirrorLocalId,
} from "./sync-entities";

describe("the sync entity table", () => {
  it("lists the entities in the order the bootstrap walks them, each once", () => {
    expect(SYNC_ENTITY_ORDER).toEqual([
      "asset_type",
      "customer",
      "asset",
      "service",
      "reference_standard",
      "environmental_limit",
      "calibration_job",
      "service_order",
      "published_method",
      "mass_composition_profile",
    ]);
    expect(Object.keys(SYNC_ENTITIES).sort()).toEqual(
      [...SYNC_ENTITY_ORDER].sort(),
    );
  });

  it("is the wire vocabulary of a pulled event's entity type", () => {
    for (const entityType of SYNC_ENTITY_ORDER) {
      expect(
        cloudSyncEventSchema.safeParse({
          cloudEventId: "e",
          entityType,
          entityId: 1,
          occurredAt: "2026-01-01T00:00:00.000Z",
          payload: {},
        }).success,
        entityType,
      ).toBe(true);
    }
    expect(
      cloudSyncEventSchema.safeParse({
        cloudEventId: "e",
        entityType: "not_an_entity",
        entityId: 1,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: {},
      }).success,
    ).toBe(false);
    expect(isSyncEntity("customer")).toBe(true);
    expect(isSyncEntity("toString")).toBe(false);
  });

  it("names, for each entity, an array of the bootstrap response, and no array twice", () => {
    const arrays = Object.keys(syncBootstrapResponseSchema.shape);
    const keys = SYNC_ENTITY_ORDER.map(
      (entity) => SYNC_ENTITIES[entity].bootstrapKey,
    );
    for (const key of keys) expect(arrays, key).toContain(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entity its own mirror table and id prefix", () => {
    const tables = SYNC_ENTITY_ORDER.map(
      (entity) => SYNC_ENTITIES[entity].mirrorTable,
    );
    const prefixes = SYNC_ENTITY_ORDER.map(
      (entity) => SYNC_ENTITIES[entity].idPrefix,
    );
    expect(new Set(tables).size).toBe(tables.length);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(syncMirrorLocalId("calibration_job", 7)).toBe("job:7");
    expect(syncMirrorLocalId("reference_standard", 7)).toBe("standard:7");
    expect(syncMirrorLocalId("service_order", 7)).toBe("service-order:7");
  });

  it("derives the delete mode and what is live from it", () => {
    expect(
      SYNC_ENTITY_ORDER.filter(
        (entity) => SYNC_ENTITIES[entity].deleteMode === "deleted_at",
      ),
    ).toEqual(["customer", "asset", "calibration_job"]);
    expect(syncMirrorLiveCondition("customer")).toBe("deleted_at IS NULL");
    expect(syncMirrorLiveCondition("reference_standard")).toBe(
      "sync_state <> 'deleted'",
    );
    expect(syncMirrorLiveCondition("service")).toBe("1 = 1");
  });

  it("derives the subsets the layers use", () => {
    expect(SYNC_SKIPPED_ROW_KINDS).toEqual([
      "customer",
      "asset",
      "calibration_job",
      "service_order",
    ]);
    expect(isSyncSkippedRowKind("asset")).toBe(true);
    expect(isSyncSkippedRowKind("service")).toBe(false);
    expect(isSyncSkippedRowKind("nope")).toBe(false);
    expect(
      SYNC_PARTITION_DOMAIN_ENTITIES.map(
        (entity) => SYNC_ENTITIES[entity].mirrorTable,
      ),
    ).toEqual([
      "customers",
      "assets",
      "reference_standards",
      "calibration_jobs",
      "service_orders",
    ]);
  });

  it("lists every table the change-log triggers cover, a standard's certificate document as a change of the standard", () => {
    expect(syncChangeLogTables()).toContainEqual({
      table: "reference_standard_certificate_document",
      entityType: "reference_standard",
    });
    expect(syncChangeLogTables()).toContainEqual({
      table: "calibration_method",
      entityType: "published_method",
    });
    expect(syncChangeLogTables()).toHaveLength(SYNC_ENTITY_ORDER.length + 1);
  });
});
