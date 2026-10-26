import { mkdtempSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyOutboxRejection,
  syncAttachmentInitUploadRequestSchema,
} from "@calibra-facil/contracts";
import {
  getLocalAttachment,
  listDeadOutboxEvents,
  openLocalDatabase,
  requeueDeadOutboxEvent,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalServerRuntime } from "./server";
import { createAssetStub, seedSyncedReferenceData } from "./test-support";

/**
 * The desktop half of the offline attachment upload leg (REQ-ATT-5): the file goes
 * init-upload -> PUT -> complete-upload before its event is pushed, and the
 * attachment is `synced` only after the cloud accepted the event.
 */
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(dbPath: string): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4319,
    appVersion: "1.4.0",
    localServerVersion: "1.4.0",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: "https://cloud.example.test",
    cloudAuthToken: "cloud-token",
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

const BYTES = Buffer.from("field photo bytes");
const HASH = createHash("sha256").update(BYTES).digest("hex");

type CloudBehaviour = {
  /** An answer for init-upload, or null for the normal one. */
  init?: () => Response | null;
  /** The status the object store answers the PUT with (200 by default). */
  put?: () => Response | Error | null;
  /** An answer for complete-upload, or null for the normal one. */
  complete?: () => Response | null;
  /** What the push adds to the acknowledgement of each pushed event. */
  push?: (eventId: string, objectKey: string | null) => Record<string, unknown>;
  /** The newest push protocol this cloud speaks; a newer push is answered SYNC_PROTOCOL_UNSUPPORTED. */
  supportedProtocol?: () => number;
  /** A refusal the push answers for every pushed event, or null to accept them. */
  rejectPush?: () => { code: string; reason: string } | null;
};

type Call = { step: string; headers: Headers; body: unknown };

/** A cloud (API + object store) that records every call, in order. */
function createCloud(behaviour: CloudBehaviour = {}) {
  const calls: Call[] = [];
  const stored = new Map<string, Uint8Array>();
  let objectKey: string | null = null;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);

    if (url.host === "store.test") {
      const body = init?.body;
      calls.push({ step: "put", headers, body });
      const answer = behaviour.put?.() ?? null;
      if (answer instanceof Error) throw answer;
      if (answer) return answer;
      stored.set(
        url.pathname,
        body instanceof Uint8Array ? body : new Uint8Array(),
      );
      return new Response(null, { status: 200 });
    }

    const parsed: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.pathname === "/api/sync/attachments/init-upload") {
      calls.push({ step: "init", headers, body: parsed });
      const override = behaviour.init?.() ?? null;
      if (override) return override;
      const declaration = syncAttachmentInitUploadRequestSchema.parse(parsed);
      objectKey = `org/org-1/sync-attachments/${declaration.entityType}/${declaration.entityId}/${declaration.contentHash.slice(0, 16)}-${declaration.eventId}`;
      return Response.json({
        attachmentId: Buffer.from(objectKey).toString("base64url"),
        objectKey,
        uploadUrl: `https://store.test/${objectKey}`,
        expiresInSeconds: 900,
        headers: { "content-type": declaration.mimeType },
      });
    }
    if (url.pathname === "/api/sync/attachments/complete-upload") {
      calls.push({ step: "complete", headers, body: parsed });
      const override = behaviour.complete?.() ?? null;
      if (override) return override;
      return Response.json({
        ok: true,
        attachmentId: Buffer.from(objectKey ?? "").toString("base64url"),
        objectKey: objectKey ?? "",
        completedAt: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/sync/push") {
      calls.push({ step: "push", headers, body: parsed });
      const requested =
        parsed && typeof parsed === "object" && "protocolVersion" in parsed
          ? parsed.protocolVersion
          : null;
      const supported = behaviour.supportedProtocol?.();
      if (
        supported !== undefined &&
        typeof requested === "number" &&
        requested > supported
      ) {
        return Response.json(
          {
            code: "SYNC_PROTOCOL_UNSUPPORTED",
            supportedProtocolVersion: supported,
            message: "newer than the cloud supports",
          },
          { status: 400 },
        );
      }
      const events =
        parsed && typeof parsed === "object" && "events" in parsed
          ? Array.isArray(parsed.events)
            ? parsed.events
            : []
          : [];
      const ids = events.flatMap((event) =>
        event && typeof event === "object" && typeof event.eventId === "string"
          ? [event.eventId]
          : [],
      );
      const rejection = behaviour.rejectPush?.() ?? null;
      if (rejection) {
        return Response.json({
          accepted: [],
          rejected: ids.map((eventId) => ({ eventId, ...rejection })),
          conflicts: [],
        });
      }
      return Response.json({
        accepted: ids.map((eventId) => ({
          eventId,
          remoteVersion: 1,
          cloudEventId: `cloud:${eventId}`,
          ...(behaviour.push?.(eventId, objectKey) ?? {
            remoteEntityId: objectKey ?? undefined,
          }),
        })),
        rejected: [],
        conflicts: [],
      });
    }
    if (url.pathname === "/api/sync/pull") {
      return Response.json({ cursor: "cursor-1", hasMore: false, events: [] });
    }
    return Response.json({ error: url.pathname }, { status: 500 });
  };

  return {
    calls,
    stored,
    fetchImpl,
    steps: () => calls.map((call) => call.step),
    get objectKey() {
      return objectKey;
    },
  };
}

async function setup(
  behaviour: CloudBehaviour = {},
  file: { name: string; type: string; bytes?: Buffer } = {
    name: "photo.jpg",
    type: "image/jpeg",
  },
  overrides: Partial<LocalServerConfig> = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-att-"));
  tempDirectories.push(directory);
  const dbPath = path.join(directory, "calibra.sqlite");
  const database = openLocalDatabase({ filePath: dbPath });
  database
    .prepare(
      `INSERT INTO tenant_snapshot (
         tenant_id, organization_id, active_unit_id, user_id,
         snapshot_json, pulled_at
       ) VALUES ('org-1', 'org-1', 1, 'user-1', '{}', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
  const cloud = createCloud(behaviour);
  const config = { ...createConfig(dbPath), ...overrides };
  const runtime = createLocalServerRuntime(config, database, {
    fetch: cloud.fetchImpl,
  });

  const form = new FormData();
  form.set("entityType", "asset");
  form.set("entityId", "local-asset-1");
  form.set(
    "file",
    new File([new Uint8Array(file.bytes ?? BYTES)], file.name, {
      type: file.type,
    }),
  );
  const created = await runtime.app.request("/api/attachments", {
    method: "POST",
    body: form,
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const attachment: { id: string; localPath: string } = await created.json();

  return { database, cloud, runtime, config, attachment };
}

function attachmentRow(database: LocalDatabase, id: string) {
  const row = getLocalAttachment(database, id);
  if (!row) throw new Error("attachment missing");
  return row;
}

function outboxRow(database: LocalDatabase) {
  const row = database
    .prepare<
      [],
      {
        status: string;
        attempt_count: number;
        error_code: string | null;
        last_error: string | null;
        next_attempt_at: string | null;
      }
    >(
      "SELECT status, attempt_count, error_code, last_error, next_attempt_at FROM outbox WHERE operation = 'create_local_attachment'",
    )
    .get();
  if (!row) throw new Error("outbox row missing");
  return row;
}

describe("REQ-ATT-5: the desktop uploads an attachment before its event", () => {
  it("uploads the file (init, PUT, complete), then pushes the event, then marks it synced", async () => {
    const { database, cloud, runtime, attachment } = await setup();
    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });

    await runtime.syncRuntime.runPushSync();

    expect(cloud.steps()).toEqual(["init", "put", "complete", "push"]);
    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: cloud.objectKey,
    });
    expect(outboxRow(database).status).toBe("synced");

    const [init, put, complete] = cloud.calls;
    // The cloud sees the cloud credentials; the object store never does.
    expect(init?.headers.get("authorization")).toBe("Bearer cloud-token");
    expect(complete?.headers.get("authorization")).toBe("Bearer cloud-token");
    expect(put?.headers.get("authorization")).toBeNull();
    expect(put?.headers.get("content-type")).toBe("image/jpeg");
    // The bytes that were PUT are the file, and the declaration binds them.
    expect(
      Buffer.from(put?.body instanceof Uint8Array ? put.body : []),
    ).toEqual(BYTES);
    expect(init?.body).toMatchObject({
      contentHash: HASH,
      sizeBytes: BYTES.byteLength,
      mimeType: "image/jpeg",
      entityType: "asset",
      entityId: "local-asset-1",
    });
    expect(complete?.body).toMatchObject({
      contentHash: HASH,
      sizeBytes: BYTES.byteLength,
      objectKey: cloud.objectKey,
    });
  });

  it("never marks the attachment synced while the upload was not completed", async () => {
    const { database, cloud, runtime, attachment } = await setup({
      complete: () =>
        Response.json(
          {
            error: "The attachment bytes were not uploaded.",
            code: "sync_attachment_not_uploaded",
          },
          { status: 409 },
        ),
    });

    await runtime.syncRuntime.runPushSync();

    // The event was not pushed at all: the cloud would have nothing to record.
    expect(cloud.steps()).toEqual(["init", "put", "complete"]);
    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
    const outbox = outboxRow(database);
    expect(outbox.status).toBe("failed");
    expect(outbox.next_attempt_at).not.toBeNull();
    expect(outbox.last_error).toContain("SYNC_ATTACHMENT_NOT_UPLOADED");
  });

  it.each([
    [
      "the store answers 503",
      { put: () => new Response(null, { status: 503 }) },
    ],
    [
      "the store answers 403 (an expired signature)",
      { put: () => new Response(null, { status: 403 }) },
    ],
    ["the network is down", { put: () => new Error("fetch failed") }],
    [
      "complete-upload answers 500",
      { complete: () => new Response(null, { status: 500 }) },
    ],
    [
      "the session expired (401)",
      { init: () => new Response(null, { status: 401 }) },
    ],
  ] satisfies Array<[string, CloudBehaviour]>)(
    "retries with backoff, never synced, when %s",
    async (_label, behaviour) => {
      const { database, cloud, runtime, attachment } = await setup(behaviour);

      await runtime.syncRuntime.runPushSync();

      expect(cloud.steps()).not.toContain("push");
      expect(attachmentRow(database, attachment.id)).toMatchObject({
        uploadStatus: "pending",
        remoteKey: null,
      });
      const outbox = outboxRow(database);
      expect(outbox.status).toBe("failed");
      expect(outbox.attempt_count).toBe(1);
      expect(outbox.next_attempt_at).not.toBeNull();
    },
  );

  it("starts the whole leg over on the next attempt and then succeeds", async () => {
    let failures = 1;
    const { database, cloud, runtime, attachment } = await setup({
      put: () => (failures-- > 0 ? new Response(null, { status: 503 }) : null),
    });

    await runtime.syncRuntime.runPushSync();
    expect(attachmentRow(database, attachment.id).uploadStatus).toBe("pending");
    // A deliberate sync tries the events that are still backing off too.
    await runtime.syncRuntime.runPushSync({ includeDeferred: true });

    expect(cloud.steps()).toEqual([
      "init",
      "put",
      "init",
      "put",
      "complete",
      "push",
    ]);
    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: cloud.objectKey,
    });
  });

  it("is synced by the key the upload returned even when an older cloud acknowledges the event without one", async () => {
    const { database, runtime, attachment, cloud } = await setup({
      push: () => ({}),
    });

    await runtime.syncRuntime.runPushSync();

    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: cloud.objectKey,
    });
  });

  describe("a permanent failure is a dead attachment", () => {
    it.each([
      [
        "init-upload refuses the type",
        {
          init: () =>
            Response.json(
              {
                error:
                  "This file type is not accepted as an offline attachment.",
                code: "sync_attachment_type_not_allowed",
              },
              { status: 415 },
            ),
        },
        "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED",
      ],
      [
        "init-upload answers a 400 that names no code",
        {
          init: () =>
            Response.json({ error: "Invalid request" }, { status: 400 }),
        },
        "ATTACHMENT_UPLOAD_REJECTED",
      ],
      [
        "the object store refuses the file with a 400",
        { put: () => new Response(null, { status: 400 }) },
        "ATTACHMENT_UPLOAD_REJECTED",
      ],
      [
        "complete-upload finds the bytes are not the declared ones",
        {
          complete: () =>
            Response.json(
              {
                error:
                  "The stored attachment does not match its declared SHA-256.",
                code: "sync_attachment_integrity_failed",
              },
              { status: 422 },
            ),
        },
        "SYNC_ATTACHMENT_INTEGRITY_FAILED",
      ],
      [
        "the role may not upload (403)",
        {
          init: () => new Response("Insufficient permissions", { status: 403 }),
        },
        "SYNC_PERMISSION_DENIED",
      ],
    ] satisfies Array<[string, CloudBehaviour, string]>)(
      "when %s",
      async (_label, behaviour, code) => {
        const { database, cloud, runtime, attachment } = await setup(behaviour);

        await runtime.syncRuntime.runPushSync();

        expect(cloud.steps()).not.toContain("push");
        expect(attachmentRow(database, attachment.id)).toMatchObject({
          uploadStatus: "dead",
          remoteKey: null,
        });
        const outbox = outboxRow(database);
        expect(outbox).toMatchObject({ status: "dead", error_code: code });
        expect(classifyOutboxRejection(code)).toBe("permanent");
        expect(listDeadOutboxEvents(database)).toEqual([
          expect.objectContaining({
            operation: "create_local_attachment",
            errorCode: code,
          }),
        ]);

        // A dead attachment is not retried by later runs.
        const callsBefore = cloud.calls.length;
        await runtime.syncRuntime.runPushSync({ includeDeferred: true });
        expect(cloud.calls.length).toBe(callsBefore);
      },
    );

    it("when the file is gone, without calling the cloud", async () => {
      const { database, cloud, runtime, attachment, config } = await setup();
      await rm(path.join(config.storageRoot, attachment.localPath));

      await runtime.syncRuntime.runPushSync();

      expect(cloud.calls).toEqual([]);
      expect(attachmentRow(database, attachment.id).uploadStatus).toBe("dead");
      expect(outboxRow(database).error_code).toBe("ATTACHMENT_FILE_MISSING");
    });

    it("when the file is no longer the one that was recorded, without calling the cloud", async () => {
      const { database, cloud, runtime, attachment, config } = await setup();
      await writeFile(
        path.join(config.storageRoot, attachment.localPath),
        "edited afterwards",
      );

      await runtime.syncRuntime.runPushSync();

      expect(cloud.calls).toEqual([]);
      expect(attachmentRow(database, attachment.id).uploadStatus).toBe("dead");
      expect(outboxRow(database).error_code).toBe("ATTACHMENT_FILE_CHANGED");
    });

    it("when the file type is not one the cloud accepts, without calling the cloud", async () => {
      const { database, cloud, runtime, attachment } = await setup(
        {},
        { name: "capture.bin", type: "application/octet-stream" },
      );

      await runtime.syncRuntime.runPushSync();

      expect(cloud.calls).toEqual([]);
      expect(attachmentRow(database, attachment.id).uploadStatus).toBe("dead");
      expect(outboxRow(database).error_code).toBe(
        "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED",
      );
    });

    it("and re-queueing it uploads the file again from the start", async () => {
      let refuse = true;
      const { database, cloud, runtime, attachment } = await setup({
        init: () =>
          refuse
            ? Response.json(
                { error: "no", code: "SYNC_ATTACHMENT_TOO_LARGE" },
                { status: 413 },
              )
            : null,
      });
      await runtime.syncRuntime.runPushSync();
      expect(attachmentRow(database, attachment.id).uploadStatus).toBe("dead");

      refuse = false;
      const [dead] = listDeadOutboxEvents(database);
      expect(requeueDeadOutboxEvent(database, dead?.eventId ?? "")).toBe(true);
      expect(attachmentRow(database, attachment.id).uploadStatus).toBe(
        "pending",
      );
      await runtime.syncRuntime.runPushSync();

      expect(cloud.steps().slice(-4)).toEqual([
        "init",
        "put",
        "complete",
        "push",
      ]);
      expect(attachmentRow(database, attachment.id).uploadStatus).toBe(
        "synced",
      );
    });
  });

  it("uploads the file again when the cloud no longer confirms it", async () => {
    let reject = true;
    const { database, cloud, runtime, attachment } = await setup({
      rejectPush: () =>
        reject
          ? {
              code: "sync_attachment_not_uploaded",
              reason: "The attachment file was not uploaded.",
            }
          : null,
    });

    await runtime.syncRuntime.runPushSync();

    // Not synced, and set back to pending so the next attempt uploads it again.
    expect(cloud.steps()).toEqual(["init", "put", "complete", "push"]);
    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
    expect(outboxRow(database).status).toBe("failed");

    reject = false;
    await runtime.syncRuntime.runPushSync({ includeDeferred: true });

    expect(cloud.steps().filter((step) => step === "put")).toHaveLength(2);
    expect(attachmentRow(database, attachment.id).uploadStatus).toBe("synced");
  });

  it("when the file grew, without reading it or calling the cloud", async () => {
    const { database, cloud, runtime, attachment, config } = await setup();
    await writeFile(
      path.join(config.storageRoot, attachment.localPath),
      "a much longer content than the one that was recorded",
    );

    await runtime.syncRuntime.runPushSync();

    expect(cloud.calls).toEqual([]);
    expect(attachmentRow(database, attachment.id).uploadStatus).toBe("dead");
    expect(outboxRow(database).error_code).toBe("ATTACHMENT_FILE_CHANGED");
  });
});

describe("REQ-ATT-6: a cloud that predates the upload leg", () => {
  it("keeps attachment events out of the push while the cloud speaks protocol 3, and sends them once it speaks 4", async () => {
    let supported = 3;
    const { database, cloud, runtime, attachment } = await setup(
      { supportedProtocol: () => supported },
      { name: "photo.jpg", type: "image/jpeg" },
      { cloudApiUrl: "https://old-cloud.example.test" },
    );
    seedSyncedReferenceData(database, { organizationId: "org-1", unitId: 1 });
    const stub = await createAssetStub(runtime.app, "Balanca Memo");
    expect(stub.status).toBe(201);

    const operationsOfPushes = () =>
      cloud.calls
        .filter((call) => call.step === "push")
        .map((call) => {
          const body = call.body;
          const record =
            body && typeof body === "object"
              ? Object.fromEntries(Object.entries(body))
              : {};
          const events = Array.isArray(record.events) ? record.events : [];
          return {
            protocolVersion: record.protocolVersion,
            operations: events.flatMap((event) =>
              event && typeof event === "object" && "operation" in event
                ? [event.operation]
                : [],
            ),
          };
        });

    // First push: asks with protocol 4, is told 3, sends again without the attachment.
    await runtime.syncRuntime.runPushSync();
    const first = operationsOfPushes();
    expect(first.map((push) => push.protocolVersion)).toEqual([4, 3]);
    expect(first[1]?.operations).toEqual(["create_local_asset"]);
    expect(outboxRow(database).status).toBe("pending");
    expect(attachmentRow(database, attachment.id).uploadStatus).not.toBe(
      "synced",
    );

    // The downgrade is remembered: the attachment is neither uploaded nor pushed.
    const callsBefore = cloud.calls.length;
    await runtime.syncRuntime.runPushSync({ includeDeferred: true });
    expect(
      cloud.calls.slice(callsBefore).map((call) => call.step),
    ).not.toContain("init");
    expect(
      operationsOfPushes()
        .filter((push) => push.protocolVersion === 3)
        .flatMap((push) => push.operations),
    ).not.toContain("create_local_attachment");

    // The cloud is upgraded; the memo expires and the attachment goes with protocol 4.
    supported = 4;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60_000);
      await runtime.syncRuntime.runPushSync({ includeDeferred: true });
    } finally {
      vi.useRealTimers();
    }

    const pushes = operationsOfPushes();
    const last = pushes[pushes.length - 1];
    expect(last?.protocolVersion).toBe(4);
    expect(last?.operations).toContain("create_local_attachment");
    expect(attachmentRow(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: cloud.objectKey,
    });
  });
});
