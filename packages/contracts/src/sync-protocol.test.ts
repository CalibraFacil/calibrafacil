import { describe, expect, it } from "vitest";
import {
  DESKTOP_UPDATE_REQUIRED_CODE,
  LEGACY_SYNC_PROTOCOL_VERSION,
  SYNC_COMMAND_OPERATIONS,
  SYNC_COMMAND_SUPPORT,
  SYNC_PROTOCOL_VERSION,
  buildSyncUpdateRequiredResponse,
  compareDesktopVersions,
  desktopUpdateRequiredMessage,
  evaluateDesktopVersionGate,
  parseSyncCommand,
  syncCommandSupport,
  syncPushRequestEnvelopeSchema,
  syncPushRequestSchema,
  syncUpdateRequiredResponseSchema,
} from "./sync-protocol";

const envelope = {
  eventId: "event:1",
  entityId: "local-1",
  occurredAt: "2026-01-15T10:05:00.000Z",
  actorUserId: "user-1",
  organizationId: "org-1",
  unitId: 1,
  idempotencyKey: "local:event:1",
  localVersion: 0,
};

/** One valid event per member of the union: [entityType, operation, payload]. */
const SAMPLES = [
  ["asset", "create_local_asset", { name: "Balança", tag: "B-1" }],
  ["calibration_job", "save_local_execution", { remoteId: 7, data: {} }],
  [
    "calibration_job",
    "submit_local_execution",
    { remoteId: 7, data: { a: "1" }, status: "REVIEW" },
  ],
  ["service_order", "create_local_service_order_intake", { assetId: 1 }],
  ["attachment", "create_local_attachment", { fileName: "a.pdf" }],
  ["asset", "update_local_asset", { name: "Novo" }],
  ["customer", "create_local_customer", { name: "ACME" }],
  ["customer", "update_local_customer", { name: "ACME 2" }],
  ["customer", "update_local_customer_compliance", { compliance: {} }],
  ["calibration_job", "create_local_job_draft", { assetId: 1, serviceId: 2 }],
  ["non_conformance", "create_local_non_conformance", { description: "x" }],
  [
    "service_order_quote",
    "create_local_service_order_quote_draft",
    { serviceOrderId: "so-1" },
  ],
  [
    "service_order_execution",
    "save_local_service_order_execution_notes",
    { notes: "n" },
  ],
  [
    "service_order_delivery_document",
    "create_local_service_order_delivery_document_draft",
    {},
  ],
  ["certificate_draft", "create_local_certificate_draft", {}],
  ["calibration_job", "generate_local_certificate_pdf", { pdf: "bytes" }],
] as const;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function eventOf(sample: readonly [string, string, unknown]) {
  const [entityType, operation, payload] = sample;
  return { ...envelope, entityType, operation, payload };
}

describe("SyncCommand union (REQ-SP-1)", () => {
  it("REQ-SP-1: every operation of the union parses its own valid event, and the samples cover the whole union", () => {
    for (const sample of SAMPLES) {
      const result = parseSyncCommand(eventOf(sample));
      expect(result.ok, sample[1]).toBe(true);
      if (result.ok) expect(result.command.operation).toBe(sample[1]);
    }
    expect(sorted(SAMPLES.map((sample) => sample[1]))).toEqual(
      sorted(SYNC_COMMAND_OPERATIONS),
    );
  });

  it("REQ-SP-1: the support table lists every member exactly once, with the operations a desktop still produces as current", () => {
    expect(sorted(Object.keys(SYNC_COMMAND_SUPPORT))).toEqual(
      sorted(SYNC_COMMAND_OPERATIONS),
    );
    expect(new Set(SYNC_COMMAND_OPERATIONS).size).toBe(
      SYNC_COMMAND_OPERATIONS.length,
    );
    const current = sorted(
      Object.entries(SYNC_COMMAND_SUPPORT)
        .filter(([, support]) => support === "current")
        .map(([operation]) => operation),
    );
    expect(current).toEqual([
      "create_local_asset",
      "create_local_attachment",
      "create_local_service_order_intake",
      "save_local_execution",
      "submit_local_execution",
    ]);
    expect(syncCommandSupport("update_local_asset")).toBe("legacy");
    expect(syncCommandSupport("save_local_execution")).toBe("current");
    expect(syncCommandSupport("approve_from_the_future")).toBeNull();
  });

  it("REQ-SP-1: an operation outside the union, or one sent for another entity type, is unsupported, not a schema failure", () => {
    expect(
      parseSyncCommand({
        ...envelope,
        entityType: "calibration_job",
        operation: "approve_local_job_from_the_future",
        payload: {},
      }),
    ).toMatchObject({ ok: false, kind: "unsupported_operation" });
    expect(
      parseSyncCommand({
        ...envelope,
        entityType: "calibration_job",
        operation: "update_local_asset",
        payload: {},
      }),
    ).toMatchObject({ ok: false, kind: "unsupported_operation" });
  });

  it("REQ-SP-1: a member's payload schema refuses a payload of the wrong kind, and the reason names paths, never values", () => {
    const wrong = parseSyncCommand({
      ...envelope,
      entityType: "calibration_job",
      operation: "submit_local_execution",
      payload: { remoteId: 7, data: "segredo-do-cliente-123" },
    });
    expect(wrong).toMatchObject({ ok: false, kind: "invalid" });
    if (!wrong.ok) {
      expect(wrong.reason).toContain("payload.data");
      expect(wrong.reason).not.toContain("segredo-do-cliente-123");
    }

    expect(
      parseSyncCommand({
        ...envelope,
        entityType: "asset",
        operation: "create_local_asset",
        payload: "not an object",
      }),
    ).toMatchObject({ ok: false, kind: "invalid" });
    expect(
      parseSyncCommand({
        ...envelope,
        entityType: "asset",
        operation: "create_local_asset",
        payload: null,
      }),
    ).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("REQ-SP-1: an event without its envelope fields is invalid", () => {
    expect(parseSyncCommand({ operation: "create_local_asset" })).toMatchObject(
      { ok: false, kind: "invalid" },
    );
    expect(parseSyncCommand("nope")).toMatchObject({
      ok: false,
      kind: "invalid",
    });
  });

  it("REQ-SP-1: the execution payload keeps the keys the cloud decides on typed and lets the snapshots through", () => {
    const result = parseSyncCommand(
      eventOf([
        "calibration_job",
        "submit_local_execution",
        {
          remoteId: 7,
          data: { a: "1" },
          results: null,
          status: "REVIEW",
          performedAt: null,
          executionPayloadVersion: 2,
          standardsSnapshot: [{ id: 1 }],
          calibrationLocationSnapshot: { type: "lab" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.payload).toMatchObject({
        standardsSnapshot: [{ id: 1 }],
      });
    }
  });
});

describe("push request header (REQ-SP-1)", () => {
  const header = {
    deviceId: "device-1",
    clientBatchId: "batch-1",
    baseCursor: null,
  };

  it("REQ-SP-1: carries the protocol version and the desktop version", () => {
    const request = syncPushRequestSchema.parse({
      ...header,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      desktopVersion: "1.4.0",
      events: [
        { ...envelope, entityType: "asset", operation: "x", payload: 1 },
      ],
    });
    expect(request.protocolVersion).toBe(SYNC_PROTOCOL_VERSION);
    expect(request.desktopVersion).toBe("1.4.0");
  });

  it("REQ-SP-1: a request without either is a build that predates versioning and stays valid", () => {
    const parsed = syncPushRequestSchema.safeParse({ ...header, events: [] });
    expect(parsed.success).toBe(true);
    expect(LEGACY_SYNC_PROTOCOL_VERSION).toBe(1);
    expect(SYNC_PROTOCOL_VERSION).toBeGreaterThan(LEGACY_SYNC_PROTOCOL_VERSION);
  });

  it("REQ-SP-2: the cloud's first read does not look inside events, so one bad event cannot fail the batch", () => {
    const parsed = syncPushRequestEnvelopeSchema.safeParse({
      ...header,
      events: [{ nonsense: true }, "also nonsense", null],
    });
    expect(parsed.success).toBe(true);
    expect(
      syncPushRequestEnvelopeSchema.safeParse({ events: [] }).success,
    ).toBe(false);
  });
});

describe("minimum desktop version (REQ-SP-6)", () => {
  it("REQ-SP-6: orders versions by semver precedence", () => {
    expect(compareDesktopVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareDesktopVersions("1.2.3", "1.10.0")).toBe(-1);
    expect(compareDesktopVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareDesktopVersions("1.2.3-beta.1", "1.2.3")).toBe(-1);
    expect(compareDesktopVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareDesktopVersions("1.2.3+build5", "1.2.3")).toBe(0);
    expect(compareDesktopVersions("test", "1.2.3")).toBeNull();
  });

  it("REQ-SP-6: prereleases order as semver says: numeric identifiers as numbers, numeric below alphanumeric, shorter below longer", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const lower = ordered[index] ?? "";
      const higher = ordered[index + 1] ?? "";
      expect(
        compareDesktopVersions(lower, higher),
        `${lower} < ${higher}`,
      ).toBe(-1);
      expect(
        compareDesktopVersions(higher, lower),
        `${higher} > ${lower}`,
      ).toBe(1);
    }
    expect(compareDesktopVersions("2.0.0-rc.9", "2.0.0-rc.10")).toBe(-1);
    expect(compareDesktopVersions("2.0.0-rc.10", "2.0.0-rc.9")).toBe(1);
    expect(compareDesktopVersions("2.0.0-rc.10", "2.0.0-rc.10")).toBe(0);
    expect(
      evaluateDesktopVersionGate({
        minimumVersion: "2.0.0-rc.10",
        desktopVersion: "2.0.0-rc.9",
      }),
    ).toMatchObject({ ok: false });
  });

  it("REQ-SP-6: no minimum configured lets every desktop through, versioned or not", () => {
    expect(
      evaluateDesktopVersionGate({
        minimumVersion: undefined,
        desktopVersion: undefined,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateDesktopVersionGate({
        minimumVersion: undefined,
        desktopVersion: "0.0.1",
      }),
    ).toEqual({ ok: true });
  });

  it("REQ-SP-6: with a minimum, an older, unversioned or unparsable desktop is refused and one at or above it passes", () => {
    const gate = (desktopVersion: string | undefined) =>
      evaluateDesktopVersionGate({ minimumVersion: "1.4.0", desktopVersion });
    expect(gate("1.3.9")).toEqual({
      ok: false,
      minimumVersion: "1.4.0",
      desktopVersion: "1.3.9",
    });
    expect(gate(undefined)).toEqual({
      ok: false,
      minimumVersion: "1.4.0",
      desktopVersion: null,
    });
    expect(gate("development")).toMatchObject({ ok: false });
    expect(gate("1.4.0")).toEqual({ ok: true });
    expect(gate("1.5.2")).toEqual({ ok: true });
  });

  it("REQ-SP-6: the update-required answer is typed and its message is pt-BR", () => {
    const response = buildSyncUpdateRequiredResponse({
      minimumVersion: "1.4.0",
      desktopVersion: "1.3.0",
    });
    expect(syncUpdateRequiredResponseSchema.parse(response)).toEqual(response);
    expect(response.code).toBe(DESKTOP_UPDATE_REQUIRED_CODE);
    expect(response.message).toBe(desktopUpdateRequiredMessage("1.4.0"));
    expect(response.message).toContain("Atualize para a versão 1.4.0");
    expect(response.message).toContain("alterações pendentes");
  });
});

describe("typed payloads of the current members (REQ-SP-1)", () => {
  const event = (entityType: string, operation: string, payload: unknown) =>
    parseSyncCommand({ ...envelope, entityType, operation, payload });

  it("REQ-SP-1: the keys the cloud reads must be of the kind it reads, for each current member", () => {
    expect(event("asset", "create_local_asset", { customerId: "abc" }).ok).toBe(
      false,
    );
    expect(event("asset", "create_local_asset", { name: 5 }).ok).toBe(false);
    expect(
      event("service_order", "create_local_service_order_intake", {
        claimedDefect: 5,
      }).ok,
    ).toBe(false);
    expect(
      event("service_order", "create_local_service_order_intake", {
        assetId: "x",
      }).ok,
    ).toBe(false);
    expect(
      event("attachment", "create_local_attachment", { sizeBytes: "big" }).ok,
    ).toBe(false);
    expect(
      event("calibration_job", "save_local_execution", { remoteId: "7" }).ok,
    ).toBe(false);
  });

  it("REQ-SP-1: what a real desktop writes is accepted (explicit nulls, extra keys), and so is an empty payload an earlier push already applied", () => {
    expect(
      event("asset", "create_local_asset", {
        customerId: 12,
        assetTypeId: 3,
        name: "Balança",
        manufacturer: null,
        model: null,
        serialNumber: "SN",
        tag: "T",
        status: "ACTIVE",
        baseMeasurementUnit: null,
        comments: null,
        specifications: { a: 1 },
        regulatedInterval: null,
      }).ok,
    ).toBe(true);
    expect(event("asset", "create_local_asset", {}).ok).toBe(true);
    expect(
      event("service_order", "create_local_service_order_intake", {
        customerId: 1,
        assetId: 2,
        clientContactId: null,
        claimedDefect: "x",
        intakeCondition: "y",
        priority: "normal",
        sourceServiceOrderId: null,
      }).ok,
    ).toBe(true);
  });
});
